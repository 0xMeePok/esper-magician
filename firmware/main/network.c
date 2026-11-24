#include "network.h"

#include <stdio.h>
#include <string.h>
#include "driver/uart.h"
#include "esp_check.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/timers.h"
#include "improv.h"
#include "mdns.h"

static const char *TAG = "network";

#define CONNECTED_BIT BIT0
#define FAILED_BIT BIT1
#define JOIN_RETRIES 5 // while Improv waits for an answer; after that, keep trying quietly

static EventGroupHandle_t s_events;
static int s_retries;
static bool s_joining;
static char s_url[40];
static char s_local_url[48];
static char s_hostname[16];
static bool s_mdns_started;
static TimerHandle_t s_retry_timer;

static void retry(TimerHandle_t timer)
{
    esp_wifi_connect();
}

bool network_connected(void)
{
    return xEventGroupGetBits(s_events) & CONNECTED_BIT;
}

const char *network_url(void)
{
    return network_connected() ? s_url : "";
}

const char *network_hostname(void)
{
    return s_hostname;
}

static void start_mdns(void)
{
    if (s_mdns_started || mdns_init() != ESP_OK) {
        return;
    }
    mdns_hostname_set(s_hostname);
    mdns_instance_name_set("ESPER screen");
    mdns_service_add(NULL, "_http", "_tcp", 80, NULL, 0);
    s_mdns_started = true;
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(s_events, CONNECTED_BIT);
        if (s_joining && ++s_retries > JOIN_RETRIES) {
            xEventGroupSetBits(s_events, FAILED_BIT);
            return;
        }
        if (s_joining) {
            esp_wifi_connect();
            return;
        }
        // Keep trying, a little slower each time, up to every 30 s.
        improv_set_state(IMPROV_STATE_READY);
        int wait = s_retries < 30 ? ++s_retries : 30;
        xTimerChangePeriod(s_retry_timer, pdMS_TO_TICKS(wait * 1000), 0);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *got = data;
        snprintf(s_url, sizeof(s_url), "http://" IPSTR "/", IP2STR(&got->ip_info.ip));
        s_retries = 0;
        start_mdns();
        ESP_LOGI(TAG, "on Wi-Fi at %s (also %s)", s_url, s_local_url);
        xEventGroupSetBits(s_events, CONNECTED_BIT);
        if (!s_joining) {
            improv_set_state(IMPROV_STATE_PROVISIONED); // the Improv join reports this itself
        }
    }
}

// Improv: join a new network. Blocks until it works or gives up.
static bool join(const char *ssid, const char *password)
{
    wifi_config_t cfg = {0};
    strncpy((char *)cfg.sta.ssid, ssid, sizeof(cfg.sta.ssid));
    strncpy((char *)cfg.sta.password, password, sizeof(cfg.sta.password));
    s_joining = true;
    s_retries = 0;
    xEventGroupClearBits(s_events, CONNECTED_BIT | FAILED_BIT);
    esp_wifi_disconnect();
    esp_wifi_set_config(WIFI_IF_STA, &cfg); // the Wi-Fi driver saves this in NVS
    esp_wifi_connect();
    EventBits_t bits = xEventGroupWaitBits(s_events, CONNECTED_BIT | FAILED_BIT, pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(30000));
    s_joining = false;
    if (!(bits & CONNECTED_BIT)) {
        esp_wifi_connect(); // keep trying in the background with the new details
    }
    return bits & CONNECTED_BIT;
}

static int urls(const char **out, int max)
{
    if (!network_connected() || max < 1) {
        return 0;
    }
    out[0] = s_url;
    if (max > 1) {
        out[1] = s_local_url;
        return 2;
    }
    return 1;
}

static void serial_write(const uint8_t *data, size_t len)
{
    uart_write_bytes(UART_NUM_0, data, len);
}

static void serial_task(void *arg)
{
    uint8_t buf[64];
    for (;;) {
        int n = uart_read_bytes(UART_NUM_0, buf, sizeof(buf), pdMS_TO_TICKS(50));
        for (int i = 0; i < n; i++) {
            improv_feed(buf[i]);
        }
    }
}

esp_err_t network_start(void)
{
    s_events = xEventGroupCreate();
    s_retry_timer = xTimerCreate("wifi retry", pdMS_TO_TICKS(1000), pdFALSE, NULL, retry);
    ESP_RETURN_ON_FALSE(s_events && s_retry_timer, ESP_ERR_NO_MEM, TAG, "no event group");

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(s_hostname, sizeof(s_hostname), "esper-%02x%02x%02x", mac[3], mac[4], mac[5]);
    snprintf(s_local_url, sizeof(s_local_url), "http://%s.local/", s_hostname);

    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "netif");
    ESP_RETURN_ON_ERROR(esp_event_loop_create_default(), TAG, "event loop");
    esp_netif_t *sta = esp_netif_create_default_wifi_sta();
    esp_netif_set_hostname(sta, s_hostname);
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&init), TAG, "wifi init");
    esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, on_event, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL);
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "mode");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "start");

    uart_config_t uart = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    ESP_RETURN_ON_ERROR(uart_driver_install(UART_NUM_0, 512, 0, 0, NULL, 0), TAG, "uart");
    uart_param_config(UART_NUM_0, &uart);
    improv_init(serial_write, join, urls, ESPER_FIRMWARE_NAME, ESPER_FIRMWARE_VERSION, "ESP32",
                "ESPER 1.9-inch screen");
    xTaskCreate(serial_task, "improv", 4096, NULL, 5, NULL);

    wifi_config_t saved = {0};
    esp_wifi_get_config(WIFI_IF_STA, &saved);
    if (saved.sta.ssid[0]) {
        esp_wifi_connect();
        // Improv says "provisioned" once the address is known; until then it
        // reports "ready", which also lets the website send new details.
    }
    improv_set_state(IMPROV_STATE_READY);
    return ESP_OK;
}
