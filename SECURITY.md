# Security Policy

## Supported Versions

VideoCull is maintained by one person, so security fixes are made for the **latest released version** only. Please update to the newest release before reporting, and check that the problem still occurs.

| Version | Supported |
| --- | --- |
| Latest release ([GitHub Releases](https://github.com/StippieDot/VideoCull/releases) or Microsoft Store) | Yes |
| Older releases | No |

## Reporting a Vulnerability

**Please do not report security vulnerabilities in public issues, discussions, or pull requests.**

Use GitHub's private vulnerability reporting instead:

1. Go to the [Security tab](https://github.com/StippieDot/VideoCull/security) of this repository.
2. Choose **Report a vulnerability**.
3. Describe the problem as completely as you can.

Direct link: <https://github.com/StippieDot/VideoCull/security/advisories/new>

A good report includes:

- The VideoCull version and edition (Microsoft Store or direct download) and your Windows version.
- What the vulnerability is and what an attacker could achieve with it.
- Step-by-step instructions to reproduce it, or a proof of concept.
- A sample file or folder structure if the problem depends on specific input. Do not attach files that contain private or illegal content; describe how to construct one instead.
- Any suggested fix, if you have one.

## What to Expect

- **Acknowledgement** within 7 days.
- **An assessment** (accepted, needs more information, or declined, with reasons) within 14 days.
- **A fix and coordinated disclosure** as soon as reasonably possible, depending on severity and complexity. Fixes ship in a new release, and a [GitHub Security Advisory](https://github.com/StippieDot/VideoCull/security/advisories) is published when the issue is confirmed.
- **Credit** in the advisory and release notes, unless you prefer to stay anonymous.

Please give me a reasonable amount of time to fix the issue before sharing details publicly.

## Scope

VideoCull is a local desktop app. It has no server component and does not upload your videos. Reports of the following kinds are in scope:

- Remote code execution or arbitrary file access through crafted media files, file names, or folder structures.
- Flaws in how the Electron main process, preload scripts, and renderer communicate (IPC), for example a way to reach Node.js APIs from renderer content.
- Path handling problems that make VideoCull read, write, or delete files outside what the user selected, including the Recycle Bin delete flow.
- Problems in the update mechanism of the direct-download edition (for example a way to make it install an unauthentic update).
- Supply-chain issues in the build and release process, including the bundled FFmpeg and FFprobe fetched by `scripts/fetch-ffmpeg.js` and verified by SHA-256.

The following are generally **out of scope**:

- Vulnerabilities in third-party components that are not exploitable through VideoCull. Please report those to the upstream project. Issues in the bundled FFmpeg build itself can be reported to [VideoCull-FFmpeg](https://github.com/StippieDot/VideoCull-FFmpeg) or to the FFmpeg project.
- Attacks that require an attacker to already have local administrator access or to be able to modify the files in `%APPDATA%\VideoCull` or the install directory.
- The Windows SmartScreen prompt for the direct installer, which is not code-signed yet. This is a known limitation, not a vulnerability.
- Denial of service through extremely large or slow collections (for example cloud-mounted drives) without a security impact.
- Reports from automated scanners without a demonstrated, reproducible impact.

## Safe Harbor

If you act in good faith, follow this policy, test only against your own installation and data, and avoid accessing or destroying anyone else's data, I will not pursue legal action against you for your research.

For non-security bugs, please [open a regular issue](https://github.com/StippieDot/VideoCull/issues).
