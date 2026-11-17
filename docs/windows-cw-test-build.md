# Windows CW test build

The local test artifacts were built from the CW fix branch with application
version `1.5.2-cwfix.808b162`. They are unsigned Windows x64 builds.

## Build from this checkout

Use **Developer PowerShell for Visual Studio**, so the MSVC `cl` compiler is
available. The project's Node packages and a working compiled `naudiodon` addon
must already be installed. From the repository root:

```powershell
npm run electron:build -- --win nsis zip --x64 --publish never -c.npmRebuild=false -c.extraMetadata.version=1.5.2-cwfix.808b162
```

`npmRebuild=false` reuses the already compiled audio addons. This particular
build was checked under the packaged Electron 41.10.7 runtime: `naudiodon`
loaded, `libopus-node` encoded an audio frame, and the bundled CW helper and
rigctld launched successfully. Revalidate native modules if dependencies or
the Electron version change; do not assume that skipping rebuild works for
arbitrary native addons or other builds.

The packaging script compiles `cw-key-helper.exe` before creating the app. This
helper is required for serial DTR/RTS CW keying. It was previously omitted from
the standard Electron build steps. The repository already contains the Windows
rigctld binary and its companion DLLs.

Outputs are in `build/`:

- `RIGCONTROL WEB Setup 1.5.2-cwfix.808b162.exe`: normal installer.
- `RIGCONTROL WEB-1.5.2-cwfix.808b162-win.zip`: unpacked application distribution.

## Try it on the station PC

1. Copy the ZIP to the Windows x64 station PC and extract the complete archive.
2. Close the currently running RigControl Web app/server before starting the
   extracted `RIGCONTROL WEB.exe`. Keep all extracted files together.
3. The ZIP avoids installation, but uses the same application identity and saved
   settings as the regular app. Back up the existing configuration if needed;
   it is not a separate application profile.
4. Connect to the real radio with its established rig model, serial port, baud
   rate, and CW output method. Dummy model 1 is only for simulated tests.
5. Access the station app in a browser on the operator's PC through the existing
   private network/VPN, using `https://<station-address>:3000` (or its configured
   port). Keep the Vail Adapter connected to the operator's PC, with Vail in
   Passthrough and the app in Iambic B at the desired speed. This exercises the
   app's network keying path without another remote-desktop keyboard layer.
6. Start with a brief low-power or dummy-load test. Compare local sidetone with
   station monitor audio separately, and verify key-up on release/disconnection.
   Test single paddles, a held squeeze, and CQ before longer operation.

The ZIP does not run the installer's firewall setup. Incoming access to the
station's configured web port must be allowed on the intended network. These
test builds are unsigned, so Windows may show an application reputation warning.

The packaging checks do not establish actual radio timing or remote-network
reliability. See [CW keyer review](cw-keyer-review.md) for timing limits and the
station validation procedure.
