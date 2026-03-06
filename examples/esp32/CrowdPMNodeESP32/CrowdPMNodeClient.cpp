#include "CrowdPMNodeClient.h"

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <FS.h>
#include <SPIFFS.h>
#include <Crypto.h>
#include <Ed25519.h>
#include <esp_system.h>
#include <time.h>
#include <mbedtls/base64.h>

namespace CrowdPM {

namespace {

const char* kDefaultApiBase = "https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi";
const char* kDefaultActivationUrl = "https://crowdpmplatform.web.app/activate";
const char* kDefaultIngestUrl = "https://us-central1-crowdpmplatform.cloudfunctions.net/ingestGateway";
const char* kDefaultModel = "esp32-live-node";
const char* kDefaultVersion = "0.0.1";

const char* kPrefPrivateKey = "sk";
const char* kPrefPublicKey = "pk";
const char* kPrefDeviceId = "device_id";
const char* kPrefQueueSeq = "qseq";

String toLowerCopy(String value) {
  value.toLowerCase();
  return value;
}

bool stringContainsAny(const String& haystack, const char* const* needles, size_t count) {
  for (size_t i = 0; i < count; ++i) {
    if (haystack.indexOf(needles[i]) >= 0) {
      return true;
    }
  }
  return false;
}

}  // namespace

/*
  Google Trust Services Root R1
  Verified against the live CrowdPM deployment on March 4, 2026.
*/
const char GtsRootR1[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFYjCCBEqgAwIBAgIQd70NbNs2+RrqIQ/E8FjTDTANBgkqhkiG9w0BAQsFADBX
MQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2lnbiBudi1zYTEQMA4GA1UE
CxMHUm9vdCBDQTEbMBkGA1UEAxMSR2xvYmFsU2lnbiBSb290IENBMB4XDTIwMDYx
OTAwMDA0MloXDTI4MDEyODAwMDA0MlowRzELMAkGA1UEBhMCVVMxIjAgBgNVBAoT
GUdvb2dsZSBUcnVzdCBTZXJ2aWNlcyBMTEMxFDASBgNVBAMTC0dUUyBSb290IFIx
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAthECix7joXebO9y/lD63
ladAPKH9gvl9MgaCcfb2jH/76Nu8ai6Xl6OMS/kr9rH5zoQdsfnFl97vufKj6bwS
iV6nqlKr+CMny6SxnGPb15l+8Ape62im9MZaRw1NEDPjTrETo8gYbEvs/AmQ351k
KSUjB6G00j0uYODP0gmHu81I8E3CwnqIiru6z1kZ1q+PsAewnjHxgsHA3y6mbWwZ
DrXYfiYaRQM9sHmklCitD38m5agI/pboPGiUU+6DOogrFZYJsuB6jC511pzrp1Zk
j5ZPaK49l8KEj8C8QMALXL32h7M1bKwYUH+E4EzNktMg6TO8UpmvMrUpsyUqtEj5
cuHKZPfmghCN6J3Cioj6OGaK/GP5Afl4/Xtcd/p2h/rs37EOeZVXtL0m79YB0esW
CruOC7XFxYpVq9Os6pFLKcwZpDIlTirxZUTQAs6qzkm06p98g7BAe+dDq6dso499
iYH6TKX/1Y7DzkvgtdizjkXPdsDtQCv9Uw+wp9U7DbGKogPeMa3Md+pvez7W35Ei
Eua++tgy/BBjFFFy3l3WFpO9KWgz7zpm7AeKJt8T11dleCfeXkkUAKIAf5qoIbap
sZWwpbkNFhHax2xIPEDgfg1azVY80ZcFuctL7TlLnMQ/0lUTbiSw1nH69MG6zO0b
9f6BQdgAmD06yK56mDcYBZUCAwEAAaOCATgwggE0MA4GA1UdDwEB/wQEAwIBhjAP
BgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBTkrysmcRorSCeFL1JmLO/wiRNxPjAf
BgNVHSMEGDAWgBRge2YaRQ2XyolQL30EzTSo//z9SzBgBggrBgEFBQcBAQRUMFIw
JQYIKwYBBQUHMAGGGWh0dHA6Ly9vY3NwLnBraS5nb29nL2dzcjEwKQYIKwYBBQUH
MAKGHWh0dHA6Ly9wa2kuZ29vZy9nc3IxL2dzcjEuY3J0MDIGA1UdHwQrMCkwJ6Al
oCOGIWh0dHA6Ly9jcmwucGtpLmdvb2cvZ3NyMS9nc3IxLmNybDA7BgNVHSAENDAy
MAgGBmeBDAECATAIBgZngQwBAgIwDQYLKwYBBAHWeQIFAwIwDQYLKwYBBAHWeQIF
AwMwDQYJKoZIhvcNAQELBQADggEBADSkHrEoo9C0dhemMXoh6dFSPsjbdBZBiLg9
NR3t5P+T4Vxfq7vqfM/b5A3Ri1fyJm9bvhdGaJQ3b2t6yMAYN/olUazsaL+yyEn9
WprKASOshIArAoyZl+tJaox118fessmXn1hIVw41oeQa1v1vg4Fv74zPl6/AhSrw
9U5pCZEt4Wi4wStz6dTZ/CLANx8LZh1J7QJVj2fhMtfTJr9w4z30Z209fOU0iOMy
+qduBmpvvYuR7hZL6Dupszfnw0Skfths18dG9ZKb59UhvmaSGZRVbNQpsg3BZlvi
d0lIKO2d1xozclOzgjXPYovJJIultzkMu34qQb9Sz/yilrbCgj8=
-----END CERTIFICATE-----
)PEM";

NodeClient::NodeClient(const Config& config)
  : config_(config) {
  if (!config_.apiBase) config_.apiBase = kDefaultApiBase;
  if (!config_.activationUrl) config_.activationUrl = kDefaultActivationUrl;
  if (!config_.ingestUrl) config_.ingestUrl = kDefaultIngestUrl;
  if (!config_.model) config_.model = kDefaultModel;
  if (!config_.version) config_.version = kDefaultVersion;
  if (!config_.rootCaPem) config_.rootCaPem = GtsRootR1;
}

bool NodeClient::begin() {
  if (!prefsOpen_) {
    prefsOpen_ = prefs_.begin(config_.preferencesNamespace, false);
    if (!prefsOpen_) {
      log("Preferences begin failed.");
      return false;
    }
  }

  if (!fsReady_) {
    fsReady_ = SPIFFS.begin(config_.formatQueueFsOnMountFailure);
    if (!fsReady_) {
      if (config_.formatQueueFsOnMountFailure) {
        log("SPIFFS mount failed. Check that your Arduino IDE partition scheme includes a SPIFFS partition.");
      } else {
        log("SPIFFS mount failed. Select an Arduino IDE partition scheme with SPIFFS or set formatQueueFsOnMountFailure=true.");
      }
      return false;
    }
  }

  startTimeSyncIfNeeded();

  if (!loadOrCreateKeyPair()) {
    log("Failed to load or create Ed25519 keypair.");
    return false;
  }

  loadPersistentState();

  if (config_.forceRepair) {
    clearProvisioning(false);
  }

  phase_ = deviceId_.length() > 0 ? Phase::Ready : Phase::Idle;
  nextActionAtMs_ = 0;
  return true;
}

void NodeClient::tick() {
  if (!prefsOpen_ || !fsReady_) return;
  if (WiFi.status() != WL_CONNECTED) return;

  if (!clockReady()) {
    startTimeSyncIfNeeded();
    if (millis() - lastClockLogAtMs_ > 5000UL) {
      log("Waiting for NTP time sync before signing DPoP requests.");
      lastClockLogAtMs_ = millis();
    }
    return;
  }

  if (!readyForAction()) return;

  if (phase_ == Phase::AwaitingApproval && pairingStartedAtMs_ > 0) {
    if (millis() - pairingStartedAtMs_ > config_.pairTimeoutMs) {
      log("Pairing window expired; starting a new pairing session.");
      clearPairingState();
    }
  }

  if (deviceId_.length() == 0) {
    if (deviceCode_.length() == 0) {
      startPairing();
      return;
    }
    pollForRegistrationToken();
    return;
  }

  phase_ = Phase::Ready;
  if (oldestQueueFile().length() == 0) {
    return;
  }

  if (!ensureAccessToken()) {
    return;
  }

  flushOneQueuedPayload();
}

bool NodeClient::queuePoint(const Point& point) {
  JsonDocument document;
  JsonArray points = document["points"].to<JsonArray>();
  JsonObject entry = points.add<JsonObject>();
  entry["pollutant"] = point.pollutant ? point.pollutant : "pm25";
  entry["value"] = point.value;
  entry["unit"] = point.unit ? point.unit : "ug/m3";
  entry["lat"] = point.lat;
  entry["lon"] = point.lon;
  entry["timestamp"] = point.timestamp.length() > 0 ? point.timestamp : iso8601UtcNow();
  entry["precision"] = point.precision;
  entry["altitude"] = point.altitude;
  return queuePayload(document);
}

bool NodeClient::queuePayload(const JsonDocument& document) {
  String payload;
  serializeJson(document, payload);
  return queuePayloadJson(payload);
}

bool NodeClient::queuePayloadJson(const String& payloadJson) {
  if (!fsReady_) {
    log("Queue filesystem is not ready.");
    return false;
  }
  if (config_.maxQueuedPayloads == 0) {
    log("Queueing is disabled because maxQueuedPayloads is set to 0.");
    return false;
  }

  JsonDocument document;
  if (!parseJson(payloadJson, document, true)) {
    log("Rejected queued payload: invalid JSON.");
    return false;
  }
  if (!document.is<JsonObject>()) {
    log("Rejected queued payload: root must be a JSON object.");
    return false;
  }
  if (!document["points"].is<JsonArray>()) {
    log("Rejected queued payload: missing points array.");
    return false;
  }

  trimQueueIfNeeded();

  const String path = nextQueueFilePath();
  if (!writeFile(path, payloadJson)) {
    log("Failed to persist queued payload to SPIFFS.");
    return false;
  }

  log("Queued payload at " + path);
  nextActionAtMs_ = 0;
  return true;
}

void NodeClient::clearQueue() {
  if (!fsReady_) return;
  File root = SPIFFS.open("/");
  File file = root.openNextFile();
  while (file) {
    const String name = String(file.name());
    file = root.openNextFile();
    if (name.startsWith(config_.queueFilePrefix)) {
      SPIFFS.remove(name);
    }
  }
}

void NodeClient::clearProvisioning(bool clearKeys) {
  deviceId_.clear();
  accessToken_.clear();
  accessTokenExpiresAt_ = 0;
  accessTokenIssuedAtMs_ = 0;
  saveDeviceId("");
  clearPairingState();
  phase_ = Phase::Idle;
  nextActionAtMs_ = 0;

  if (clearKeys) {
    prefs_.remove(kPrefPrivateKey);
    prefs_.remove(kPrefPublicKey);
    memset(privateKey_, 0, sizeof(privateKey_));
    memset(publicKey_, 0, sizeof(publicKey_));
    publicKeyX_.clear();
    loadOrCreateKeyPair();
  }
}

bool NodeClient::isProvisioned() const {
  return deviceId_.length() > 0;
}

const String& NodeClient::deviceId() const {
  return deviceId_;
}

const String& NodeClient::pendingUserCode() const {
  return userCode_;
}

const String& NodeClient::pendingActivationUrl() const {
  return activationUrlComplete_;
}

size_t NodeClient::queuedPayloadCount() {
  if (!fsReady_) return 0;
  size_t count = 0;
  File root = SPIFFS.open("/");
  File file = root.openNextFile();
  while (file) {
    if (String(file.name()).startsWith(config_.queueFilePrefix)) {
      ++count;
    }
    file = root.openNextFile();
  }
  return count;
}

void NodeClient::setLogCallback(LogCallback callback) {
  logCallback_ = callback;
}

void NodeClient::setActivationCallback(ActivationCallback callback) {
  activationCallback_ = callback;
}

void NodeClient::setProvisionedCallback(DeviceCallback callback) {
  provisionedCallback_ = callback;
}

void NodeClient::setRevokedCallback(EventCallback callback) {
  revokedCallback_ = callback;
}

void NodeClient::log(const String& message) const {
  if (logCallback_) {
    logCallback_(message);
    return;
  }
  Serial.println(message);
}

void NodeClient::startTimeSyncIfNeeded() {
  if (ntpStarted_) return;
  configTime(0, 0, config_.ntpServer1, config_.ntpServer2, config_.ntpServer3);
  ntpStarted_ = true;
}

bool NodeClient::clockReady() const {
  return time(nullptr) > kValidEpochFloor;
}

bool NodeClient::loadOrCreateKeyPair() {
  const size_t privateLen = prefs_.getBytesLength(kPrefPrivateKey);
  const size_t publicLen = prefs_.getBytesLength(kPrefPublicKey);

  if (privateLen == sizeof(privateKey_) && publicLen == sizeof(publicKey_)) {
    prefs_.getBytes(kPrefPrivateKey, privateKey_, sizeof(privateKey_));
    prefs_.getBytes(kPrefPublicKey, publicKey_, sizeof(publicKey_));
  } else {
    esp_fill_random(privateKey_, sizeof(privateKey_));
    Ed25519::derivePublicKey(publicKey_, privateKey_);
    prefs_.putBytes(kPrefPrivateKey, privateKey_, sizeof(privateKey_));
    prefs_.putBytes(kPrefPublicKey, publicKey_, sizeof(publicKey_));
  }

  publicKeyX_ = base64UrlEncode(publicKey_, sizeof(publicKey_));
  return publicKeyX_.length() > 0;
}

void NodeClient::loadPersistentState() {
  deviceId_ = prefs_.getString(kPrefDeviceId, "");
}

void NodeClient::saveDeviceId(const String& deviceId) {
  deviceId_ = deviceId;
  prefs_.putString(kPrefDeviceId, deviceId);
}

void NodeClient::clearPairingState() {
  deviceCode_.clear();
  userCode_.clear();
  activationUrlComplete_.clear();
  pairingStartedAtMs_ = 0;
  pollIntervalSeconds_ = 5;
}

bool NodeClient::startPairing() {
  JsonDocument requestDoc;
  requestDoc["pub_ke"] = publicKeyX_;
  requestDoc["model"] = config_.model;
  requestDoc["version"] = config_.version;
  requestDoc["nonce"] = makeNonce();

  String body;
  serializeJson(requestDoc, body);

  HttpResponse response = httpJson("POST", buildEndpoint("/device/start"), body, "", "", "");
  if (response.status != 200) {
    if (isRetryableError(response.status)) {
      scheduleRetry("Pairing start failed with retryable error.");
      return false;
    }
    log("Pairing start failed: HTTP " + String(response.status) + " " + response.body);
    scheduleRetry("Pairing start failed.");
    return false;
  }

  JsonDocument responseDoc;
  if (!parseJson(response.body, responseDoc)) {
    scheduleRetry("Pairing start response was not valid JSON.");
    return false;
  }

  deviceCode_ = responseDoc["device_code"] | "";
  userCode_ = responseDoc["user_code"] | "";
  String verificationUriComplete;
  if (responseDoc["verification_uri_complete"].is<const char*>()) {
    verificationUriComplete = String(responseDoc["verification_uri_complete"].as<const char*>());
  } else {
    verificationUriComplete = String(config_.activationUrl) + "?code=" + userCode_;
  }
  activationUrlComplete_ = verificationUriComplete;
  pollIntervalSeconds_ = responseDoc["poll_interval"] | 5;
  pairingStartedAtMs_ = millis();
  phase_ = Phase::AwaitingApproval;
  resetRetryState();
  scheduleDelay(static_cast<unsigned long>(pollIntervalSeconds_) * 1000UL);

  log("Pairing started. user_code=" + userCode_);
  log("Activation URL: " + activationUrlComplete_);
  if (activationCallback_) {
    activationCallback_(userCode_, activationUrlComplete_);
  }
  return true;
}

bool NodeClient::pollForRegistrationToken() {
  const String tokenUrl = buildEndpoint("/device/token");
  const String dpop = createDpopProof(deriveHtu(tokenUrl, config_.apiBase), "POST");

  JsonDocument requestDoc;
  requestDoc["device_code"] = deviceCode_;
  String body;
  serializeJson(requestDoc, body);

  HttpResponse response = httpJson("POST", tokenUrl, body, "", dpop, urlProto(tokenUrl));
  String errorCode;
  String message;
  int nextPollInterval = pollIntervalSeconds_;
  extractErrorDetails(response.body, errorCode, message, nextPollInterval);

  if (response.status == 200) {
    JsonDocument responseDoc;
    if (!parseJson(response.body, responseDoc)) {
      scheduleRetry("Token response was not valid JSON.");
      return false;
    }
    const String registrationToken = responseDoc["registration_token"] | "";
    if (registrationToken.length() == 0) {
      scheduleRetry("Token response missing registration_token.");
      return false;
    }
    resetRetryState();
    return registerDevice(registrationToken);
  }

  if (response.status == 400 && errorCode == "authorization_pending") {
    scheduleDelay(static_cast<unsigned long>(pollIntervalSeconds_) * 1000UL);
    return false;
  }

  if (response.status == 400 && errorCode == "slow_down") {
    pollIntervalSeconds_ = nextPollInterval > 0 ? nextPollInterval : (pollIntervalSeconds_ + 5);
    scheduleDelay(static_cast<unsigned long>(pollIntervalSeconds_) * 1000UL);
    return false;
  }

  if (response.status == 400 && errorCode == "expired_token") {
    log("Pairing session expired before browser approval completed.");
    clearPairingState();
    scheduleDelay(1000UL);
    return false;
  }

  if (isRetryableError(response.status)) {
    scheduleRetry("Token polling hit a retryable error.");
    return false;
  }

  log("Token polling failed: HTTP " + String(response.status) + " " + response.body);
  scheduleRetry("Token polling failed.");
  return false;
}

bool NodeClient::registerDevice(const String& registrationToken) {
  const String registerUrl = buildEndpoint("/device/register");
  const String dpop = createDpopProof(deriveHtu(registerUrl, config_.apiBase), "POST");

  JsonDocument requestDoc;
  JsonObject jwk = requestDoc["jwk_pub_kl"].to<JsonObject>();
  jwk["kty"] = "OKP";
  jwk["crv"] = "Ed25519";
  jwk["x"] = publicKeyX_;

  String body;
  serializeJson(requestDoc, body);

  HttpResponse response = httpJson(
    "POST",
    registerUrl,
    body,
    "Bearer " + registrationToken,
    dpop,
    urlProto(registerUrl)
  );

  String errorCode;
  String message;
  int unusedPollInterval = 0;
  extractErrorDetails(response.body, errorCode, message, unusedPollInterval);

  if (response.status == 200) {
    JsonDocument responseDoc;
    if (!parseJson(response.body, responseDoc)) {
      scheduleRetry("Register response was not valid JSON.");
      return false;
    }
    const String deviceId = responseDoc["device_id"] | "";
    if (deviceId.length() == 0) {
      scheduleRetry("Register response missing device_id.");
      return false;
    }

    saveDeviceId(deviceId);
    accessToken_.clear();
    accessTokenExpiresAt_ = 0;
    accessTokenIssuedAtMs_ = 0;
    clearPairingState();
    phase_ = Phase::Ready;
    resetRetryState();
    nextActionAtMs_ = 0;

    log("Device registered with device_id=" + deviceId_);
    if (provisionedCallback_) {
      provisionedCallback_(deviceId_);
    }
    return true;
  }

  if (response.status == 400 && errorCode == "expired_token") {
    log("Registration token expired; restarting pairing.");
    clearProvisioning(false);
    scheduleDelay(1000UL);
    return false;
  }

  if (isRetryableError(response.status)) {
    scheduleRetry("Device registration hit a retryable error.");
    return false;
  }

  log("Device registration failed: HTTP " + String(response.status) + " " + response.body);
  scheduleRetry("Device registration failed.");
  return false;
}

bool NodeClient::ensureAccessToken() {
  if (deviceId_.length() == 0) return false;

  const time_t now = time(nullptr);
  const bool tokenStillValid =
    accessToken_.length() > 0
    && accessTokenExpiresAt_ > now + 30
    && (millis() - accessTokenIssuedAtMs_) < config_.maxAccessTokenAgeMs;
  if (tokenStillValid) {
    return true;
  }

  const String accessUrl = buildEndpoint("/device/access-token");
  const String dpop = createDpopProof(deriveHtu(accessUrl, config_.apiBase), "POST");

  JsonDocument requestDoc;
  requestDoc["device_id"] = deviceId_;
  JsonArray scope = requestDoc["scope"].to<JsonArray>();
  scope.add("ingest.write");

  String body;
  serializeJson(requestDoc, body);

  HttpResponse response = httpJson("POST", accessUrl, body, "", dpop, urlProto(accessUrl));

  String errorCode;
  String message;
  int unusedPollInterval = 0;
  extractErrorDetails(response.body, errorCode, message, unusedPollInterval);

  if (response.status == 200) {
    JsonDocument responseDoc;
    if (!parseJson(response.body, responseDoc)) {
      scheduleRetry("Access token response was not valid JSON.");
      return false;
    }
    accessToken_ = responseDoc["access_token"] | "";
    const int expiresIn = responseDoc["expires_in"] | 600;
    accessTokenExpiresAt_ = now + expiresIn;
    accessTokenIssuedAtMs_ = millis();
    resetRetryState();
    return accessToken_.length() > 0;
  }

  accessToken_.clear();
  accessTokenExpiresAt_ = 0;
  accessTokenIssuedAtMs_ = 0;

  if (config_.autoRepairOnRevocation && isRevocationLikeError(response.status, errorCode, message)) {
    handleRevocation(message.length() > 0 ? message : errorCode);
    return false;
  }

  if (isRetryableError(response.status) || response.status == 401) {
    scheduleRetry("Access token request failed; will retry.");
    return false;
  }

  log("Access token request failed: HTTP " + String(response.status) + " " + response.body);
  scheduleRetry("Access token request failed.");
  return false;
}

bool NodeClient::flushOneQueuedPayload() {
  const String queuePath = oldestQueueFile();
  if (queuePath.length() == 0) {
    nextActionAtMs_ = 0;
    return true;
  }

  String rawPayload;
  if (!readFile(queuePath, rawPayload)) {
    log("Failed to read queued payload; dropping " + queuePath);
    removeFile(queuePath);
    nextActionAtMs_ = 0;
    return false;
  }

  String normalizedPayload;
  if (!normalizePayloadForCurrentDevice(rawPayload, normalizedPayload)) {
    log("Queued payload is invalid; dropping " + queuePath);
    removeFile(queuePath);
    nextActionAtMs_ = 0;
    return false;
  }

  HttpResponse response;
  if (!sendQueuedPayload(normalizedPayload, response)) {
    return false;
  }

  if (!removeFile(queuePath)) {
    log("Queued payload sent but file removal failed for " + queuePath);
  } else {
    log("Queued payload delivered and removed: " + queuePath);
  }

  resetRetryState();
  nextActionAtMs_ = 0;
  return true;
}

bool NodeClient::sendQueuedPayload(const String& payloadBody, HttpResponse& response) {
  const String ingestUrl(config_.ingestUrl);
  const String dpop = createDpopProof(deriveHtu(ingestUrl, config_.ingestUrl), "POST");

  response = httpJson(
    "POST",
    ingestUrl,
    payloadBody,
    "Bearer " + accessToken_,
    dpop,
    urlProto(ingestUrl)
  );

  String errorCode;
  String message;
  int unusedPollInterval = 0;
  extractErrorDetails(response.body, errorCode, message, unusedPollInterval);

  if (response.status == 202) {
    return true;
  }

  if (response.status == 401) {
    accessToken_.clear();
    accessTokenExpiresAt_ = 0;
    accessTokenIssuedAtMs_ = 0;
    scheduleRetry("Ingest token rejected; refreshing access token.");
    return false;
  }

  if (config_.autoRepairOnRevocation && isRevocationLikeError(response.status, errorCode, message)) {
    handleRevocation(message.length() > 0 ? message : errorCode);
    return false;
  }

  if (response.status == 400 && errorCode == "device_id_mismatch") {
    log("device_id_mismatch from ingest despite payload normalization; dropping current access token.");
    accessToken_.clear();
    accessTokenExpiresAt_ = 0;
    accessTokenIssuedAtMs_ = 0;
    scheduleRetry("Ingest device_id mismatch.");
    return false;
  }

  if (isRetryableError(response.status)) {
    scheduleRetry("Ingest failed with retryable error.");
    return false;
  }

  log("Dropping queued payload after non-retryable ingest error: HTTP " + String(response.status) + " " + response.body);
  return true;
}

void NodeClient::handleRevocation(const String& reason) {
  log("Provisioned device became invalid; auto re-pairing. Reason: " + reason);
  clearProvisioning(false);
  if (revokedCallback_) {
    revokedCallback_();
  }
  nextActionAtMs_ = 0;
}

bool NodeClient::isRevocationLikeError(int status, const String& errorCode, const String& message) const {
  if (status != 403 && status != 401) return false;

  const String combined = toLowerCopy(errorCode + " " + message);
  static const char* const revocationPhrases[] = {
    "device not active",
    "device not found",
    "device account unavailable",
    "device account disabled",
    "account disabled",
    "revoked",
    "suspended",
  };
  return stringContainsAny(combined, revocationPhrases, sizeof(revocationPhrases) / sizeof(revocationPhrases[0]));
}

bool NodeClient::isRetryableError(int status) const {
  return status < 0 || status == 408 || status == 409 || status == 425 || status == 429 || status >= 500;
}

void NodeClient::resetRetryState() {
  consecutiveFailures_ = 0;
  nextActionAtMs_ = 0;
}

void NodeClient::scheduleRetry(const String& reason) {
  ++consecutiveFailures_;
  const uint8_t exponent = consecutiveFailures_ > 7 ? 7 : consecutiveFailures_ - 1;
  unsigned long delayMs = config_.retryBaseMs << exponent;
  if (delayMs > config_.retryMaxMs) {
    delayMs = config_.retryMaxMs;
  }
  const unsigned long jitterMax = delayMs / 4UL;
  const unsigned long jitter = jitterMax > 0 ? esp_random() % (jitterMax + 1UL) : 0UL;
  nextActionAtMs_ = millis() + delayMs + jitter;
  log(reason + " Backing off for " + String(delayMs + jitter) + " ms.");
}

void NodeClient::scheduleDelay(unsigned long delayMs) {
  nextActionAtMs_ = millis() + delayMs;
}

bool NodeClient::readyForAction() const {
  return nextActionAtMs_ == 0 || static_cast<long>(millis() - nextActionAtMs_) >= 0;
}

String NodeClient::nextQueueFilePath() {
  const uint32_t nextValue = prefs_.getULong(kPrefQueueSeq, 0) + 1;
  prefs_.putULong(kPrefQueueSeq, nextValue);

  char buffer[96];
  snprintf(buffer, sizeof(buffer), "%s%08lu.json", config_.queueFilePrefix, static_cast<unsigned long>(nextValue));
  return String(buffer);
}

String NodeClient::oldestQueueFile() const {
  if (!fsReady_) return String();

  String oldest;
  File root = SPIFFS.open("/");
  File file = root.openNextFile();
  while (file) {
    const String name = String(file.name());
    if (name.startsWith(config_.queueFilePrefix) && (oldest.length() == 0 || name < oldest)) {
      oldest = name;
    }
    file = root.openNextFile();
  }
  return oldest;
}

bool NodeClient::readFile(const String& path, String& contents) const {
  File file = SPIFFS.open(path, FILE_READ);
  if (!file) {
    return false;
  }
  contents = file.readString();
  return true;
}

bool NodeClient::writeFile(const String& path, const String& contents) {
  File file = SPIFFS.open(path, FILE_WRITE);
  if (!file) {
    return false;
  }
  const size_t written = file.print(contents);
  file.close();
  return written == contents.length();
}

bool NodeClient::removeFile(const String& path) {
  return SPIFFS.remove(path);
}

void NodeClient::trimQueueIfNeeded() {
  while (queuedPayloadCount() >= config_.maxQueuedPayloads) {
    const String oldest = oldestQueueFile();
    if (oldest.length() == 0) {
      return;
    }
    log("Queue full; dropping oldest payload " + oldest);
    removeFile(oldest);
  }
}

bool NodeClient::normalizePayloadForCurrentDevice(const String& rawPayload, String& normalizedPayload) const {
  JsonDocument document;
  if (!parseJson(rawPayload, document, true)) {
    return false;
  }
  if (!document.is<JsonObject>() || !document["points"].is<JsonArray>()) {
    return false;
  }

  document["device_id"] = deviceId_;
  JsonArray points = document["points"].as<JsonArray>();
  for (JsonObject point : points) {
    point["device_id"] = deviceId_;
    if (!point["timestamp"].is<const char*>()) {
      point["timestamp"] = iso8601UtcNow();
    }
  }

  normalizedPayload.remove(0);
  serializeJson(document, normalizedPayload);
  return normalizedPayload.length() > 0;
}

bool NodeClient::parseJson(const String& body, JsonDocument& document, bool quiet) const {
  const DeserializationError err = deserializeJson(document, body);
  if (!err) {
    return true;
  }
  if (!quiet) {
    log("JSON parse failed: " + String(err.c_str()));
    log(body);
  }
  return false;
}

void NodeClient::extractErrorDetails(const String& body, String& errorCode, String& message, int& pollIntervalSeconds) const {
  errorCode = "";
  message = "";
  pollIntervalSeconds = 0;

  JsonDocument document;
  if (!parseJson(body, document, true)) {
    return;
  }

  if (document["error"].is<const char*>()) {
    errorCode = String(document["error"].as<const char*>());
  }
  if (document["message"].is<const char*>()) {
    message = String(document["message"].as<const char*>());
  } else if (document["error_description"].is<const char*>()) {
    message = String(document["error_description"].as<const char*>());
  }
  if (document["poll_interval"].is<int>()) {
    pollIntervalSeconds = document["poll_interval"].as<int>();
  }
}

String NodeClient::makeNonce() const {
  const uint64_t mac = ESP.getEfuseMac();
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "esp32-%08lx", static_cast<unsigned long>(mac & 0xFFFFFFFFULL));
  return String(buffer);
}

String NodeClient::iso8601UtcNow() const {
  const time_t now = time(nullptr);
  struct tm tmUtc;
  gmtime_r(&now, &tmUtc);
  char buffer[32];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
  return String(buffer);
}

bool NodeClient::signEd25519(const String& message, uint8_t signature[64]) const {
  Ed25519::sign(
    signature,
    privateKey_,
    publicKey_,
    reinterpret_cast<const uint8_t*>(message.c_str()),
    message.length()
  );
  return true;
}

String NodeClient::createDpopProof(const String& htu, const char* method) const {
  JsonDocument headerDoc;
  headerDoc["alg"] = "EdDSA";
  headerDoc["typ"] = "dpop+jwt";
  JsonObject jwk = headerDoc["jwk"].to<JsonObject>();
  jwk["kty"] = "OKP";
  jwk["crv"] = "Ed25519";
  jwk["x"] = publicKeyX_;

  JsonDocument payloadDoc;
  payloadDoc["htm"] = method;
  payloadDoc["htu"] = htu;
  payloadDoc["iat"] = static_cast<long>(time(nullptr));
  payloadDoc["jti"] = makeNonce() + "-" + String(static_cast<unsigned long>(esp_random()), HEX);

  String headerJson;
  String payloadJson;
  serializeJson(headerDoc, headerJson);
  serializeJson(payloadDoc, payloadJson);

  const String signingInput = base64UrlEncode(headerJson) + "." + base64UrlEncode(payloadJson);

  uint8_t signature[64];
  if (!signEd25519(signingInput, signature)) {
    return String();
  }

  return signingInput + "." + base64UrlEncode(signature, sizeof(signature));
}

NodeClient::HttpResponse NodeClient::httpJson(
  const String& method,
  const String& url,
  const String& body,
  const String& authHeader,
  const String& dpopHeader,
  const String& forwardedProto
) const {
  WiFiClientSecure client;
  client.setCACert(config_.rootCaPem);
#if defined(ESP_ARDUINO_VERSION_MAJOR)
  client.setHandshakeTimeout(config_.tlsHandshakeTimeoutSeconds);
#endif

  HTTPClient http;
  HttpResponse response;

  if (!http.begin(client, url)) {
    response.status = -1;
    response.body = "http.begin failed";
    return response;
  }

  http.setReuse(false);
  http.setTimeout(config_.httpTimeoutMs);
  http.setConnectTimeout(config_.httpConnectTimeoutMs);
  http.addHeader("Content-Type", "application/json");

  if (authHeader.length() > 0) {
    http.addHeader("Authorization", authHeader);
  }
  if (dpopHeader.length() > 0) {
    http.addHeader("DPoP", dpopHeader);
  }
  if (forwardedProto.length() > 0) {
    http.addHeader("x-forwarded-proto", forwardedProto);
  }

  if (method == "GET") {
    response.status = http.GET();
  } else if (method == "POST") {
    response.status = http.POST(body);
  } else {
    response.status = http.sendRequest(
      method.c_str(),
      reinterpret_cast<uint8_t*>(const_cast<char*>(body.c_str())),
      body.length()
    );
  }

  response.body = http.getString();
  http.end();
  return response;
}

bool NodeClient::parseUrl(const String& rawUrl, ParsedUrl& parsed) const {
  const int schemeSep = rawUrl.indexOf("://");
  if (schemeSep < 0) return false;

  parsed.scheme = rawUrl.substring(0, schemeSep);
  const int hostStart = schemeSep + 3;
  const int pathStart = rawUrl.indexOf('/', hostStart);
  if (pathStart < 0) {
    parsed.host = rawUrl.substring(hostStart);
    parsed.path = "/";
    return parsed.host.length() > 0;
  }

  parsed.host = rawUrl.substring(hostStart, pathStart);
  parsed.path = rawUrl.substring(pathStart);

  const int fragmentStart = parsed.path.indexOf('#');
  if (fragmentStart >= 0) {
    parsed.path = parsed.path.substring(0, fragmentStart);
  }
  return parsed.host.length() > 0;
}

String NodeClient::buildEndpoint(const char* path) const {
  String out(config_.apiBase);
  if (!out.endsWith("/")) out += "/";
  if (path[0] == '/') {
    out += (path + 1);
  } else {
    out += path;
  }
  return out;
}

String NodeClient::deriveHtu(const String& targetUrl, const String& baseUrl) const {
  ParsedUrl target;
  ParsedUrl base;
  if (!parseUrl(targetUrl, target)) return String();
  if (!parseUrl(baseUrl, base)) return String();

  String basePath = base.path;
  if (basePath.endsWith("/")) {
    basePath.remove(basePath.length() - 1);
  }

  String trimmedPath = target.path;
  if (basePath.length() > 0 && trimmedPath.startsWith(basePath)) {
    trimmedPath = trimmedPath.substring(basePath.length());
  }
  if (trimmedPath.length() == 0) {
    trimmedPath = "/";
  }
  return target.scheme + "://" + target.host + trimmedPath;
}

String NodeClient::urlProto(const String& rawUrl) const {
  ParsedUrl parsed;
  return parseUrl(rawUrl, parsed) ? parsed.scheme : "https";
}

String NodeClient::base64UrlEncode(const uint8_t* input, size_t inputLen) const {
  size_t encodedLen = 0;
  mbedtls_base64_encode(nullptr, 0, &encodedLen, input, inputLen);

  unsigned char* encoded = new unsigned char[encodedLen + 1];
  if (mbedtls_base64_encode(encoded, encodedLen, &encodedLen, input, inputLen) != 0) {
    delete[] encoded;
    return String();
  }
  encoded[encodedLen] = '\0';

  String out(reinterpret_cast<char*>(encoded));
  delete[] encoded;
  out.replace("+", "-");
  out.replace("/", "_");
  while (out.endsWith("=")) {
    out.remove(out.length() - 1);
  }
  return out;
}

String NodeClient::base64UrlEncode(const String& input) const {
  return base64UrlEncode(reinterpret_cast<const uint8_t*>(input.c_str()), input.length());
}

}  // namespace CrowdPM
