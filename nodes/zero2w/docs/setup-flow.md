# CrowdPM Zero 2 W setup flow

This is the tested setup flow for the Raspberry Pi Zero 2 W node as of
2026-05-13.

## Verified radio behavior

The Zero 2 W can run:

- `wlan0` as the normal station client for the owner's Wi-Fi
- `uap0` as an open setup access point at the same time

The radio supports `managed + AP` concurrently, but only on one channel. In
practice that means:

- the setup AP can stay online while the node joins the owner's Wi-Fi
- the AP uses the same channel as the joined Wi-Fi network
- the phone may briefly notice a network transition during association

## Correct user flow

The original idea was close, but one detail matters:

- the CrowdPM pairing `user_code` does not exist until the node has internet

So the correct shipped flow is:

1. The user powers on the mailed node.
2. The node brings up an open setup network such as `CrowdPM Setup D5A3`.
3. The user connects to that open network.
4. Captive portal detection should send the browser to the local setup page, or the user can open `http://10.42.0.1/`.
5. The page shows the node status and a Wi-Fi form.
6. The user selects their home Wi-Fi SSID and enters the password.
7. The node joins the owner's Wi-Fi on `wlan0`.
8. The setup AP remains up on `uap0` during pairing, so the local page can still show progress.
9. Once internet is available, the node calls CrowdPM `POST /device/start`.
10. The local page updates with the real `user_code` and `verification_uri_complete`.
11. The user copies the code or opens the full activation link and approves the device on `https://crowdpmplatform.web.app/activate`.
12. The node polls `POST /device/token`, completes `POST /device/register`, stores its `device_id`, and switches to normal paired mode.
13. After pairing completes, the node can stop advertising the setup AP.
14. While away from known Wi-Fi, the node stores PM2.5 measurements locally in SQLite.
15. Measurements are grouped into local batches over a time window instead of uploading one point at a time.
16. A Wi-Fi connect or disconnect closes the current local batch so movement across coverage zones creates a natural batch boundary.
17. When the node reaches the provisioned Wi-Fi again, it requests a fresh access token and uploads any closed local batches automatically.

## What was implemented

- Open setup AP via NetworkManager on `uap0`
- Local HTTP setup portal on port `80`
- Wi-Fi credential capture and station provisioning on `wlan0`
- Live pairing flow against CrowdPM deployed endpoints
- Persistent device state and key storage
- Local SQLite measurement queue for offline batches
- Time-windowed local batches that close on Wi-Fi transitions or point-count limits
- Automatic retry and batch flush when the configured Wi-Fi is reachable again

## Important product notes

- A real pairing code cannot be shown before Wi-Fi provisioning, because the
  backend issues that code.
- If the user's phone still has cellular internet while connected to the open
  AP, they can tap the full activation link directly from the local page.
- If the phone loses internet on the open AP, the page still shows the code so
  the user can copy it and finish approval another way.

## Current ingest limitation

The deployed ingest contract currently accepts PM2.5 points with location and
timestamp. DHT22 temperature and humidity are available locally for diagnostics,
but they are not part of the current CrowdPM ingest payload schema.
