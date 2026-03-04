#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>

namespace CrowdPM {

extern const char GtsRootR1[] PROGMEM;

struct Point {
  const char* pollutant = "pm25";
  float value = 0.0f;
  const char* unit = "ug/m3";
  double lat = 0.0;
  double lon = 0.0;
  String timestamp;
  int precision = 0;
  float altitude = 0.0f;
};

struct Config {
  const char* apiBase = nullptr;
  const char* activationUrl = nullptr;
  const char* ingestUrl = nullptr;
  const char* model = nullptr;
  const char* version = nullptr;
  const char* preferencesNamespace = "crowdpm";
  const char* queueFilePrefix = "/crowdpmq_";
  const char* rootCaPem = nullptr;
  const char* ntpServer1 = "time.google.com";
  const char* ntpServer2 = "pool.ntp.org";
  const char* ntpServer3 = "time.cloudflare.com";
  bool forceRepair = false;
  bool autoRepairOnRevocation = true;
  bool formatQueueFsOnMountFailure = false;
  unsigned long pairTimeoutMs = 15UL * 60UL * 1000UL;
  unsigned long retryBaseMs = 2000UL;
  unsigned long retryMaxMs = 5UL * 60UL * 1000UL;
  unsigned long maxAccessTokenAgeMs = 2UL * 60UL * 1000UL;
  uint16_t httpTimeoutMs = 15000;
  uint16_t httpConnectTimeoutMs = 15000;
  uint16_t tlsHandshakeTimeoutSeconds = 15;
  size_t maxQueuedPayloads = 128;
};

class NodeClient {
public:
  using LogCallback = void (*)(const String& message);
  using ActivationCallback = void (*)(const String& userCode, const String& activationUrl);
  using DeviceCallback = void (*)(const String& deviceId);
  using EventCallback = void (*)();

  explicit NodeClient(const Config& config = Config());

  bool begin();
  void tick();

  bool queuePoint(const Point& point);
  bool queuePayload(const JsonDocument& document);
  bool queuePayloadJson(const String& payloadJson);

  void clearQueue();
  void clearProvisioning(bool clearKeys = false);

  bool isProvisioned() const;
  const String& deviceId() const;
  const String& pendingUserCode() const;
  const String& pendingActivationUrl() const;
  size_t queuedPayloadCount();

  void setLogCallback(LogCallback callback);
  void setActivationCallback(ActivationCallback callback);
  void setProvisionedCallback(DeviceCallback callback);
  void setRevokedCallback(EventCallback callback);

private:
  struct HttpResponse {
    int status = -1;
    String body;
  };

  struct ParsedUrl {
    String scheme;
    String host;
    String path;
  };

  enum class Phase {
    Idle,
    AwaitingApproval,
    Ready,
  };

  static constexpr time_t kValidEpochFloor = 1700000000;

  Config config_;
  Preferences prefs_;
  bool prefsOpen_ = false;
  bool fsReady_ = false;
  bool ntpStarted_ = false;
  Phase phase_ = Phase::Idle;

  uint8_t privateKey_[32] = {};
  uint8_t publicKey_[32] = {};
  String publicKeyX_;

  String deviceId_;
  String accessToken_;
  String deviceCode_;
  String userCode_;
  String activationUrlComplete_;

  time_t accessTokenExpiresAt_ = 0;
  unsigned long accessTokenIssuedAtMs_ = 0;
  unsigned long pairingStartedAtMs_ = 0;
  unsigned long nextActionAtMs_ = 0;
  unsigned long lastClockLogAtMs_ = 0;
  uint8_t consecutiveFailures_ = 0;
  int pollIntervalSeconds_ = 5;

  LogCallback logCallback_ = nullptr;
  ActivationCallback activationCallback_ = nullptr;
  DeviceCallback provisionedCallback_ = nullptr;
  EventCallback revokedCallback_ = nullptr;

  void log(const String& message) const;
  void startTimeSyncIfNeeded();
  bool clockReady() const;

  bool loadOrCreateKeyPair();
  void loadPersistentState();
  void saveDeviceId(const String& deviceId);
  void clearPairingState();

  bool startPairing();
  bool pollForRegistrationToken();
  bool registerDevice(const String& registrationToken);
  bool ensureAccessToken();
  bool flushOneQueuedPayload();
  bool sendQueuedPayload(const String& payloadBody, HttpResponse& response);

  void handleRevocation(const String& reason);
  bool isRevocationLikeError(int status, const String& errorCode, const String& message) const;
  bool isRetryableError(int status) const;

  void resetRetryState();
  void scheduleRetry(const String& reason);
  void scheduleDelay(unsigned long delayMs);
  bool readyForAction() const;

  String nextQueueFilePath();
  String oldestQueueFile() const;
  bool readFile(const String& path, String& contents) const;
  bool writeFile(const String& path, const String& contents);
  bool removeFile(const String& path);
  void trimQueueIfNeeded();
  bool normalizePayloadForCurrentDevice(const String& rawPayload, String& normalizedPayload) const;

  bool parseJson(const String& body, JsonDocument& document, bool quiet = false) const;
  void extractErrorDetails(const String& body, String& errorCode, String& message, int& pollIntervalSeconds) const;

  String makeNonce() const;
  String iso8601UtcNow() const;
  bool signEd25519(const String& message, uint8_t signature[64]) const;
  String createDpopProof(const String& htu, const char* method) const;

  HttpResponse httpJson(
    const String& method,
    const String& url,
    const String& body,
    const String& authHeader,
    const String& dpopHeader,
    const String& forwardedProto
  ) const;

  bool parseUrl(const String& rawUrl, ParsedUrl& parsed) const;
  String buildEndpoint(const char* path) const;
  String deriveHtu(const String& targetUrl, const String& baseUrl) const;
  String urlProto(const String& rawUrl) const;
  String base64UrlEncode(const uint8_t* input, size_t inputLen) const;
  String base64UrlEncode(const String& input) const;
};

}  // namespace CrowdPM
