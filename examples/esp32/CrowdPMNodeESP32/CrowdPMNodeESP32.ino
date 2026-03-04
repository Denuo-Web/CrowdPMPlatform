/*
  CrowdPMNodeESP32.ino

  Thin example wrapper around CrowdPM::NodeClient.
  Keep this file small and move your real GPS / OLED / PM logic around the
  client in your production firmware.

  Required libraries:
  - ArduinoJson
  - Crypto by Rhys Weatherley
*/

#include <WiFi.h>
#include "CrowdPMNodeClient.h"

namespace {

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const unsigned long SAMPLE_INTERVAL_MS = 60000UL;
unsigned long gLastSampleAt = 0;

void logToSerial(const String& message) {
  Serial.println(message);
}

void onActivationRequired(const String& userCode, const String& activationUrl) {
  Serial.println();
  Serial.println("== Manual Approval Required ==");
  Serial.print("user_code: ");
  Serial.println(userCode);
  Serial.print("activation_url: ");
  Serial.println(activationUrl);
  Serial.println("Display these values on your OLED or companion UI.");
}

void onProvisioned(const String& deviceId) {
  Serial.print("Device provisioned: ");
  Serial.println(deviceId);
}

void onRevoked() {
  Serial.println("Device credentials are no longer valid. Starting a new pairing flow.");
}

bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.print("Connecting Wi-Fi to ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (millis() - startedAt > 30000UL) {
      Serial.println();
      Serial.println("Wi-Fi connection timed out.");
      return false;
    }
  }

  Serial.println();
  Serial.print("Wi-Fi connected. IP=");
  Serial.println(WiFi.localIP());
  return true;
}

CrowdPM::Config makeConfig() {
  CrowdPM::Config config;
  config.model = "esp32-live-node";
  config.version = "0.0.1";
  config.forceRepair = false;
  config.autoRepairOnRevocation = true;
  config.maxQueuedPayloads = 256;
  config.maxAccessTokenAgeMs = 120000UL;
  return config;
}

CrowdPM::NodeClient gNode(makeConfig());

CrowdPM::Point buildSamplePoint() {
  CrowdPM::Point point;
  point.pollutant = "pm25";
  point.value = 10.0f + static_cast<float>((millis() / 1000UL) % 20UL) * 0.35f;
  point.unit = "ug/m3";
  point.lat = 45.5231;
  point.lon = -122.6765;
  point.precision = 6;
  point.altitude = 12.0f;
  return point;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("== CrowdPM ESP32 Node ==");

  gNode.setLogCallback(logToSerial);
  gNode.setActivationCallback(onActivationRequired);
  gNode.setProvisionedCallback(onProvisioned);
  gNode.setRevokedCallback(onRevoked);

  if (!connectWifi()) {
    Serial.println("Cannot continue without Wi-Fi.");
    return;
  }

  if (!gNode.begin()) {
    Serial.println("CrowdPM node initialization failed.");
    return;
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  if (millis() - gLastSampleAt >= SAMPLE_INTERVAL_MS) {
    gNode.queuePoint(buildSamplePoint());
    gLastSampleAt = millis();
  }

  gNode.tick();
  delay(250);
}
