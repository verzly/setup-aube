# verzly/setup-aube

```yaml
- uses: verzly/setup-aube@v1
```

`verzly/setup-aube` installs aube in GitHub Actions using official release binaries.

It resolves versions from npm dist-tags, downloads the matching upstream binary from aube GitHub repository, adds it to `PATH`, and can optionally run install commands in a pnpm-style workflow.

* [Usage](#usage)
  * [Basic](#basic)
  * [With explicit version](#with-explicit-version)
  * [With automatic install](#with-automatic-install)
  * [Advanced `run_install`](#advanced-run_install)
  * [Inputs](#inputs)
  * [Outputs](#outputs)
* [How it works](#how-it-works)
* [Version resolution](#version-resolution)
* [Example workflow](#example-workflow)
* [Contributing](#contributing)
* [License & Acknowledgments](#license--acknowledgments)

## Usage

Use this action to install `aube` in your workflow and make it available on the `PATH` for subsequent steps.

It works on `x64` and `arm64` runners across Linux, macOS, and Windows, and requires no additional setup.

### Basic

This installs the latest version of `aube` and lets you run commands directly:

```yaml
steps:
  - uses: actions/checkout@v4

  - uses: verzly/setup-aube@v1

  - run: aube install
```

### With explicit version

If you need a specific version (for reproducibility or debugging), you can pin it:

```yaml
- uses: verzly/setup-aube@v1
  with:
    version: v1.0.0-beta.10
```

### With automatic install

To automatically install dependencies as part of setup:

```yaml
- uses: verzly/setup-aube@v1
  with:
    run_install: true
```

This is equivalent to running `aube install` right after setup.

### Advanced `run_install`

For more control, you can pass a structured configuration:

```yaml
- uses: verzly/setup-aube@v1
  with:
    run_install: |
      command: ci
      cwd: app
      args:
        - --prod
```

This allows you to customize how and where install commands are executed.

### Inputs

| Name          | Description                               | Default  |
| ------------- | ----------------------------------------- | -------- |
| `version`     | aube version (`latest`, `next`, or exact) | `latest` |
| `run_install` | Run `aube install` automatically          | `null`   |

### Outputs

| Name      | Description                                   |
| --------- | --------------------------------------------- |
| `version` | Resolved aube version (e.g. `v1.0.0-beta.10`) |
| `bin-dir` | Directory added to PATH                       |

## How it works

This action installs `aube` by resolving the requested version from npm, downloading the matching prebuilt binary from the official releases, extracting it, and adding it to the system `PATH`. Once installed, it can optionally run `aube install` (or other install commands) as part of the setup.

This action avoids using the GitHub API entirely, which means it does not run into rate limits and does not require any authentication token. Instead of installing `aube` through npm, it relies on the official prebuilt binaries, so there is no Node-based wrapper involved.

By using native binaries directly, the setup remains fast and predictable. The same approach works consistently across Linux, macOS, and Windows, making it a reliable choice for CI environments where reproducibility and simplicity are important.

## Version resolution

The action supports `latest`, `next`, and exact versions such as:

```yaml
version: v1.0.0-beta.10
```

When `latest` or `next` is used, the action resolves the actual version by querying npm dist-tags:

```sh
npm view @endevco/aube dist-tags --json
```

This allows us to determine the current release version without relying on the GitHub API. By using npm as the source of truth for version tags, the action avoids the need for a GitHub token and eliminates the risk of hitting GitHub API rate limits.

## Example workflow

```yaml
name: CI

on: push

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: verzly/setup-aube@v1

      - run: aube install
      - run: aube test
```

## Contributing

To contribute to this project, start by installing the required tools using mise:

```sh
mise install
```

This installs everything defined in `mise.toml`, including aube and hk.

The action is bundled using:

```sh
aube package
```

which generates the compiled output in:

```
dist/index.js
```

However, you usually don’t need to run this manually. The repository is configured with `hk` pre-commit hooks. After installing them with:

```sh
hk install
```

every commit will automatically:

* run `aube package`
* update and stage the `dist/` directory

This ensures that the committed build output is always in sync with the source code.

### WSL note (important)

If you are using WSL, make sure to run Git from the same environment where you are developing. Avoid mixing Windows Git with the WSL filesystem (or the other way around), as this can prevent hooks from running correctly.

### Workflow summary

```sh
mise install
hk install

# develop...

git commit
```

Build and `dist/` updates are handled automatically as part of the commit process.

## License & Acknowledgments

This project would not exist without the creators and contributors of [aube](https://github.com/endevco/aube). It is open source and released under the [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html).

Copyright (C) 2020—present [Zoltán Rózsa](https://github.com/rozsazoltan) & [Verzly](https://github.com/verzly)
