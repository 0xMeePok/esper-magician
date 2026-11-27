#include "dns.h"

#include <string.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "network.h"

static const char *TAG = "setup";

static volatile bool s_run;
static TaskHandle_t s_task;

// Answers each question with the screen's hotspot address (A records), or with
// no answer (anything else, such as AAAA).
static int answer(uint8_t *buf, int n, int cap)
{
    if (n < 12 || (buf[2] & 0x80) || buf[4] != 0 || buf[5] != 1) {
        return 0; // not a query with one question
    }
    int p = 12;
    while (p < n && buf[p]) {
        if (buf[p] & 0xC0) {
            return 0; // questions don't use compression
        }
        p += buf[p] + 1;
    }
    if (p + 5 > n) {
        return 0;
    }
    p++;
    bool a_record = buf[p] == 0 && buf[p + 1] == 1;
    p += 4; // type and class
    buf[2] = 0x84 | (buf[2] & 0x01); // a response, authoritative, keeping "recursion desired"
    buf[3] = 0x80;                   // recursion available, no error
    buf[6] = 0;
    buf[7] = a_record ? 1 : 0;
    memset(buf + 8, 0, 4); // drop authority and additional records
    if (!a_record || p + 16 > cap) {
        return p;
    }
    static const uint8_t record[] = {
        0xC0, 0x0C,             // the name in the question
        0x00, 0x01, 0x00, 0x01, // A, IN
        0x00, 0x00, 0x00, 0x3C, // 60 s
        0x00, 0x04, 192, 168, 4, 1,
    };
    memcpy(buf + p, record, sizeof(record));
    return p + sizeof(record);
}

static void dns_task(void *arg)
{
    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port = htons(53),
        .sin_addr.s_addr = htonl(INADDR_ANY),
    };
    struct timeval wait = {.tv_sec = 1};
    if (sock < 0 || bind(sock, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        ESP_LOGW(TAG, "DNS server didn't start; open http://" NETWORK_SETUP_IP "/ by hand");
        if (sock >= 0) {
            close(sock);
        }
        s_task = NULL;
        vTaskDelete(NULL);
        return;
    }
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &wait, sizeof(wait));
    uint8_t buf[512];
    while (s_run) {
        struct sockaddr_in from;
        socklen_t from_len = sizeof(from);
        int n = recvfrom(sock, buf, sizeof(buf), 0, (struct sockaddr *)&from, &from_len);
        int len = n > 0 ? answer(buf, n, sizeof(buf)) : 0;
        if (len > 0) {
            sendto(sock, buf, len, 0, (struct sockaddr *)&from, from_len);
        }
    }
    close(sock);
    s_task = NULL;
    vTaskDelete(NULL);
}

void dns_start(void)
{
    if (s_task) {
        return;
    }
    s_run = true;
    xTaskCreate(dns_task, "dns", 3072, NULL, 4, &s_task);
}

void dns_stop(void)
{
    s_run = false; // the task stops within a second
}
