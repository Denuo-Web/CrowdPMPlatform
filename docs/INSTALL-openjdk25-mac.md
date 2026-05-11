# Install OpenJDK 25 On macOS

Firebase emulators require a local JDK. Use any trusted JDK 25 distribution; Homebrew is the simplest path for most contributors.

## Homebrew

```bash
brew update
brew search openjdk
brew install openjdk@25
```

If Homebrew reports a different formula name for JDK 25, install that formula instead.

Expose the JDK to macOS Java tooling. Adjust the Homebrew prefix if needed.

```bash
sudo ln -sfn /opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk \
  /Library/Java/JavaVirtualMachines/openjdk-25.jdk
```

For Intel Macs, the prefix is usually `/usr/local`:

```bash
sudo ln -sfn /usr/local/opt/openjdk@25/libexec/openjdk.jdk \
  /Library/Java/JavaVirtualMachines/openjdk-25.jdk
```

Add `JAVA_HOME` if your shell does not find the JDK automatically:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 25)
export PATH="$JAVA_HOME/bin:$PATH"
```

Validate:

```bash
java --version
javac --version
echo "$JAVA_HOME"
```
