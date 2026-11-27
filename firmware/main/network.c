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
#include "dns.h"
#include "improv.h"
#include "mdns.h"

static const char *TAG = "network";
static const char *SETUP_TAG = "setup";

#define CONNECTED_BIT BIT0
#define FAILED_BIT BIT1
#define JOIN_RETRIES 5 // while Improv waits for an answer; after that, keep trying quietly
#define SETUP_AFTER_FAILS 6     // failed tries on the saved network before the hotspot opens
#define SETUP_RETRY_S 60        // with the hotspot on, how often to try the saved network again
#define SETUP_OFF_MS 90000      // once joined, how long the hotspot stays for the page to show it

// What the setup task is asked to do.
#define DO_HOTSPOT_ON BIT0
#define DO_HOTSPOT_OFF BIT1
#define DO_JOIN BIT2

static EventGroupHandle_t s_events;
static int s_retries;
static bool s_joining;
static char s_url[40];
static char s_local_url[48];
static char s_hostname[16];
static bool s_mdns_started;
static TimerHandle_t s_retry_timer;

static TaskHandle_t s_setup_task;
static TimerHandle_t s_setup_off_timer;
static volatile bool s_setup;
static char s_setup_name[16];
static volatile setup_state_t s_setup_state;
static volatile uint8_t s_last_reason; // why the router last turned the screen away
static char s_setup_ssid[33];
static char s_setup_password[65];

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

const char *network_local_url(void)
{
    return s_local_url;
}

bool network_setup_active(void)
{
    return s_setup;
}

const char *network_setup_name(void)
{
    return s_setup_name;
}

setup_state_t network_setup_state(const char **ssid)
{
    if (ssid) {
        *ssid = s_setup_ssid;
    }
    return s_setup_state;
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

// The router's reason for turning the screen away, in plain words.
static const char *reason_words(uint8_t reason)
{
    switch (reason) {
    case WIFI_REASON_NO_AP_FOUND:
    case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:
    case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD:
    case WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD:
        return "network not found (out of range, or 5 GHz only)";
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_MIC_FAILURE:
        return "wrong password";
    case WIFI_REASON_AUTH_EXPIRE:
    case WIFI_REASON_ASSOC_FAIL:
    case WIFI_REASON_CONNECTION_FAIL:
    case WIFI_REASON_BEACON_TIMEOUT:
        return "the router didn't answer";
    default:
        return "disconnected";
    }
}

const char *network_setup_problem(void)
{
    return s_setup_state == SETUP_FAILED ? reason_words(s_last_reason) : "";
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        const wifi_event_sta_disconnected_t *gone = data;
        s_last_reason = gone->reason;
        // The website shows this line to say why the Wi-Fi didn't work.
        ESP_LOGW(TAG, "Wi-Fi \"%.*s\": %s (reason %d)", gone->ssid_len, (const char *)gone->ssid,
                 reason_words(gone->reason), gone->reason);
        xEventGroupClearBits(s_events, CONNECTED_BIT);
        if (s_joining && ++s_retries > JOIN_RETRIES) {
            xEventGroupSetBits(s_events, FAILED_BIT);
            return;
        }
        if (s_joining) {
            esp_wifi_connect();
            return;
        }
        // Keep trying, a little slower each time, up to every 30 s. After a few
        // misses, open the setup hotspot too, so the details can be changed.
        improv_set_state(IMPROV_STATE_READY);
        int wait = s_retries < 30 ? ++s_retries : 30;
        if (s_retries == SETUP_AFTER_FAILS && !s_setup) {
            ESP_LOGW(SETUP_TAG, "can't reach the saved Wi-Fi: opening the setup hotspot");
            xTaskNotify(s_setup_task, DO_HOTSPOT_ON, eSetBits);
        }
        if (s_setup) {
            wait = SETUP_RETRY_S; // each try briefly takes the radio off the hotspot's channel
        }
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
        if (s_setup) {
            xTimerStart(s_setup_off_timer, 0);
        }
    }
}

// Improv: join a new network. Blocks until it works or gives up.
static bool join(const char *ssid, const char *password)
{
    wifi_config_t cfg = {0};
    strncpy((char *)cfg.sta.ssid, ssid, sizeof(cfg.sta.ssid));
    strncpy((char *)cfg.sta.password, password, sizeof(cfg.sta.password));
    ESP_LOGI(TAG, "joining \"%s\"", ssid);
    s_joining = true;
    s_retries = 0;
    s_last_reason = 0;
    xEventGroupClearBits(s_events, CONNECTED_BIT | FAILED_BIT);
    esp_wifi_disconnect();
    esp_wifi_set_config(WIFI_IF_STA, &cfg); // the Wi-Fi driver saves this in NVS
    esp_wifi_connect();
    EventBits_t bits = xEventGroupWaitBits(s_events, CONNECTED_BIT | FAILED_BIT, pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(30000));
    s_joining = false;
    if (!(bits & CONNECTED_BIT)) {
        ESP_LOGW(TAG, "couldn't join \"%s\": %s", ssid,
                 s_last_reason ? reason_words(s_last_reason) : "no answer in 30 s");
        esp_wifi_connect(); // keep trying in the background with the new details
    }
    return bits & CONNECTED_BIT;
}

// ---- Setup hotspot ----

static void hotspot_on(void)
{
    if (s_setup) {
        return;
    }
    wifi_config_t ap = {
        .ap = {
            .channel = 1,
            .max_connection = 4,
            .authmode = WIFI_AUTH_OPEN,
        },
    };
    ap.ap.ssid_len = strlcpy((char *)ap.ap.ssid, s_setup_name, sizeof(ap.ap.ssid));
    if (esp_wifi_set_mode(WIFI_MODE_APSTA) != ESP_OK || esp_wifi_set_config(WIFI_IF_AP, &ap) != ESP_OK) {
        ESP_LOGW(SETUP_TAG, "hotspot didn't start");
        return;
    }
    s_setup = true;
    s_setup_state = SETUP_IDLE;
    dns_start();
    // The website reads this line to show the hotspot when the screen is dark.
    ESP_LOGI(SETUP_TAG, "hotspot on: join \"%s\" (no password), then open http://" NETWORK_SETUP_IP "/",
             s_setup_name);
}

static void hotspot_off(void)
{
    if (!s_setup) {
        return;
    }
    dns_stop();
    esp_wifi_set_mode(WIFI_MODE_STA);
    s_setup = false;
    s_setup_state = SETUP_IDLE;
    ESP_LOGI(SETUP_TAG, "hotspot off");
}

static void setup_off_later(TimerHandle_t timer)
{
    xTaskNotify(s_setup_task, DO_HOTSPOT_OFF, eSetBits);
}

// Turning the hotspot on and off and joining can block, so they run here
// rather than in Wi-Fi events, timers or web requests.
static void setup_task(void *arg)
{
    for (;;) {
        uint32_t what = 0;
        xTaskNotifyWait(0, UINT32_MAX, &what, portMAX_DELAY);
        if (what & DO_HOTSPOT_ON) {
            hotspot_on();
        }
        if (what & DO_JOIN) {
            s_setup_state = SETUP_JOINING;
            bool ok = join(s_setup_ssid, s_setup_password);
            memset(s_setup_password, 0, sizeof(s_setup_password));
            s_setup_state = ok ? SETUP_JOINED : SETUP_FAILED;
            if (ok) {
                ESP_LOGI(SETUP_TAG, "joined \"%s\" from the setup page; hotspot off in %d s", s_setup_ssid,
                         SETUP_OFF_MS / 1000);
            }
        }
        if (what & DO_HOTSPOT_OFF) {
            hotspot_off();
        }
    }
}

esp_err_t network_setup_join(const char *ssid, const char *password)
{
    ESP_RETURN_ON_FALSE(ssid[0] && strlen(ssid) < sizeof(s_setup_ssid) &&
                            strlen(password) < sizeof(s_setup_password),
                        ESP_ERR_INVALID_ARG, SETUP_TAG, "bad details");
    ESP_RETURN_ON_FALSE(s_setup_state != SETUP_JOINING, ESP_ERR_INVALID_STATE, SETUP_TAG, "busy");
    strlcpy(s_setup_ssid, ssid, sizeof(s_setup_ssid));
    strlcpy(s_setup_password, password, sizeof(s_setup_password));
    s_setup_state = SETUP_JOINING;
    xTaskNotify(s_setup_task, DO_JOIN, eSetBits);
    return ESP_OK;
}

int network_scan(wifi_ap_record_t *out, int max)
{
    if (s_joining || esp_wifi_scan_start(NULL, true) != ESP_OK) {
        return 0;
    }
    uint16_t n = max;
    if (esp_wifi_scan_get_ap_records(&n, out) != ESP_OK) {
        return 0;
    }
    return n;
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
    snprintf(s_setup_name, sizeof(s_setup_name), "ESPER-%02X%02X%02X", mac[3], mac[4], mac[5]);
    s_setup_off_timer = xTimerCreate("setup off", pdMS_TO_TICKS(SETUP_OFF_MS), pdFALSE, NULL, setup_off_later);
    ESP_RETURN_ON_FALSE(s_setup_off_timer, ESP_ERR_NO_MEM, TAG, "no timer");
    ESP_RETURN_ON_FALSE(xTaskCreate(setup_task, "setup", 4096, NULL, 5, &s_setup_task) == pdPASS,
                        ESP_ERR_NO_MEM, TAG, "no setup task");

    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "netif");
    ESP_RETURN_ON_ERROR(esp_event_loop_create_default(), TAG, "event loop");
    esp_netif_t *sta = esp_netif_create_default_wifi_sta();
    esp_netif_set_hostname(sta, s_hostname);
    esp_netif_create_default_wifi_ap(); // used only while the setup hotspot is on
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&init), TAG, "wifi init");
    esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, on_event, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL);
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "mode");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "start");
    // The screen runs off USB, so keep the radio awake. Modem sleep made the
    // access point drop it part way through receiving a picture.
    ESP_RETURN_ON_ERROR(esp_wifi_set_ps(WIFI_PS_NONE), TAG, "power save");

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
        ESP_LOGI(TAG, "joining saved Wi-Fi \"%s\"", (const char *)saved.sta.ssid);
        esp_wifi_connect();
        // Improv says "provisioned" once the address is known; until then it
        // reports "ready", which also lets the website send new details.
    } else {
        ESP_LOGI(SETUP_TAG, "no Wi-Fi saved yet");
        xTaskNotify(s_setup_task, DO_HOTSPOT_ON, eSetBits);
    }
    improv_set_state(IMPROV_STATE_READY);
    return ESP_OK;
}
