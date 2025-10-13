### Install Open JDK 25 on Mac

Look into updating or installing HomeBrew if you do not already have it.

Install Open JDK via HomeBrew

```
brew install openjdk
```

Symlink it
```
sudo ln -sfn /opt/homebrew/opt/openjdk/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk.jdk
```

Check install

```
java -version
```
