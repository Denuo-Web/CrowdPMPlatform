# Install OpenJDK 25 On Linux

Firebase emulators require a local JDK. Use a package manager when it offers JDK 25; otherwise install a JDK 25 tarball manually.

## Package Manager

Check your distribution first:

```bash
apt-cache search openjdk-25 || true
dnf search openjdk25 || true
```

Install the JDK 25 package if available, then verify:

```bash
java --version
javac --version
```

## Manual Tarball Fallback

Download an OpenJDK 25 Linux x64 tarball from a trusted distribution such as Adoptium or the OpenJDK archive.

```bash
cd ~/Downloads
sha256sum openjdk-25*_linux-x64_bin.tar.gz
sudo mkdir -p /usr/lib/jvm
sudo tar -xzf openjdk-25*_linux-x64_bin.tar.gz -C /usr/lib/jvm
ls -1 /usr/lib/jvm
```

Create a stable symlink. Adjust the source directory if the extracted name differs.

```bash
sudo ln -sfn /usr/lib/jvm/jdk-25 /usr/lib/jvm/jdk-current
```

Register alternatives:

```bash
sudo update-alternatives --install /usr/bin/java java /usr/lib/jvm/jdk-current/bin/java 2500
sudo update-alternatives --install /usr/bin/javac javac /usr/lib/jvm/jdk-current/bin/javac 2500
sudo update-alternatives --config java
sudo update-alternatives --config javac
```

Optional shell profile:

```bash
sudo tee /etc/profile.d/jdk25.sh >/dev/null <<'EOF'
export JAVA_HOME=/usr/lib/jvm/jdk-current
export PATH="$JAVA_HOME/bin:$PATH"
EOF
source /etc/profile.d/jdk25.sh
```

Validate:

```bash
java --version
javac --version
echo "$JAVA_HOME"
```
