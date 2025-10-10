# Install OpenJDK 25 from Tarball (Linux)

This guide performs a manual system-wide install from the official tarball.

## 1) Download and verify

```bash
cd ~/Downloads
wget 'https://download.java.net/java/GA/jdk25/bd75d5f9689641da8e1daabeccb5528b/36/GPL/openjdk-25_linux-x64_bin.tar.gz'

# Optional: verify integrity (compare with the hash on the download page)
sha256sum openjdk-25_linux-x64_bin.tar.gz
```

## 2) Extract to a standard JDK location

```bash
sudo mkdir -p /usr/lib/jvm
sudo tar -xzf openjdk-25_linux-x64_bin.tar.gz -C /usr/lib/jvm
# The archive typically creates /usr/lib/jvm/jdk-25 or /usr/lib/jvm/jdk-25.0.x
ls -1 /usr/lib/jvm
```

## 3) Create a stable symlink

```bash
# Adjust the right-hand path if the extracted directory name differs
sudo ln -sfn /usr/lib/jvm/jdk-25 /usr/lib/jvm/jdk-current
```

## 4) Register with system alternatives

### Debian/Ubuntu

```bash
sudo update-alternatives --install /usr/bin/java  java  /usr/lib/jvm/jdk-current/bin/java  2500
sudo update-alternatives --install /usr/bin/javac javac /usr/lib/jvm/jdk-current/bin/javac 2500
# If multiple JDKs exist, select the desired one:
sudo update-alternatives --config java
sudo update-alternatives --config javac
```

### Fedora/RHEL/CentOS/Alma/Rocky

```bash
sudo alternatives --install /usr/bin/java  java  /usr/lib/jvm/jdk-current/bin/java  2500
sudo alternatives --install /usr/bin/javac javac /usr/lib/jvm/jdk-current/bin/javac 2500
sudo alternatives --config java
sudo alternatives --config javac
```

## 5) Set `JAVA_HOME` for all users (optional but common)

```bash
sudo sh -c 'cat >/etc/profile.d/jdk25.sh << "EOF"
export JAVA_HOME=/usr/lib/jvm/jdk-current
export PATH="$JAVA_HOME/bin:$PATH"
EOF'
sudo chmod 644 /etc/profile.d/jdk25.sh
# Load in the current shell
source /etc/profile.d/jdk25.sh
```

## 6) Validate

```bash
java -version
javac -version
echo "$JAVA_HOME"
```

## Uninstall / Revert

```bash
# Debian/Ubuntu
sudo update-alternatives --remove java  /usr/lib/jvm/jdk-current/bin/java  || true
sudo update-alternatives --remove javac /usr/lib/jvm/jdk-current/bin/javac || true

# Fedora/RHEL family
sudo alternatives --remove java  /usr/lib/jvm/jdk-current/bin/java  || true
sudo alternatives --remove javac /usr/lib/jvm/jdk-current/bin/javac || true

# Remove env and files
sudo rm -f /etc/profile.d/jdk25.sh
sudo rm -rf /usr/lib/jvm/jdk-25* /usr/lib/jvm/jdk-current
hash -r
```

## Notes

- Keep the tarball for quick reinstall.
- If the extracted directory name differs (e.g., `jdk-25.0.0`), point the symlink to that exact name.
- Package managers simplify updates; this manual method provides full control.
