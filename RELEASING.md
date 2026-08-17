# Releasing Open Quill

How versions are numbered, how builds are published, and the exact commands for each step.

For what the release screen shows and how to fill it in, see [Release notes](#release-notes). For what to do when CI blocks a release, see [When something fails](#when-something-fails).

---

## The model

Two branches:

| Branch | What it is |
| --- | --- |
| `dev` | Where work lands. Always ahead of `stable`. |
| `stable` | What has been released. Only ever receives merges from `dev`. |

**Channels live in the version string, not in branch names.** A version with a prerelease tail is pre-GA; a bare version is released:

| Version | Means | Published as |
| --- | --- | --- |
| `27.2.0-beta.0` | 27.2.0 in development, nothing published | nothing |
| `27.2.0-beta.3` | third published beta of 27.2.0 | GitHub pre-release |
| `27.2.0` | 27.2.0, released | GitHub release, marked Latest |

**A tag is the version string exactly**: `27.2.0-beta.3`, no `v` prefix. The root `.npmrc` sets `tag-version-prefix=` so `npm version` agrees, and both release workflows match the bare form.

Tags are created **where the code will be released from**: betas are tagged on `dev`, releases are tagged on `stable`. That is the only reason the release step below uses `--no-git-tag-version`.

---

## Everyday work on `dev`

Maintainers commit as often as they like and leave the version alone. It changes only when something is published.

```bash
git add -A
git commit -m "Fix submenu overlap"
git push
```

`package.json` stays where it is. Nothing is published, and no workflow fires beyond CI.

---

## Publishing a beta

For a point worth sharing. Work must be committed first, because `npm version` refuses to run on a dirty tree.

```bash
npm version prerelease --preid=beta
git push --follow-tags
```

`npm version` does three things in one step, which is why nothing appears unstaged afterwards:

1. bumps `package.json` and `package-lock.json` (`beta.2` → `beta.3`)
2. commits them, with the version as the commit message
3. creates the annotated tag `27.1.0-beta.3`

`--follow-tags` pushes the commit and the tag together. `prerelease.yml` then builds a zip and opens a **draft** pre-release named `27.1.0 Beta 3`. It stays invisible until a maintainer publishes it from the Releases page.

> Pushing without `--follow-tags` lands the commit but not the tag, so no release appears. `git push --tags` fixes it.

---

## Cutting a release

### 1. Drop the prerelease tail, on `dev`

```bash
npm version patch --no-git-tag-version
git commit -am "Release 27.1.0"
git push
```

`patch` on a prerelease drops the tail without incrementing: `27.1.0-beta.7` → `27.1.0`.

`--no-git-tag-version` edits the file only, with no commit and no tag. That is deliberate: the tag must wait until the code is on `stable`, or `release.yml` rejects it.

### 2. Finish the release notes

Both of these must be true before the PR is opened, or CI stops the release:

- `CHANGELOG.md` has a `## [27.1.0]` section with a real date, not `TBD`
- `release/27/` exists with `release.json`, `notes.md` and an icon

Both are verifiable locally:

```bash
npm run check:release
```

### 3. Merge into `stable`

Open a PR from `dev` into `stable` and merge it. `version-guard.yml` verifies the version actually went up.

### 4. Tag it from `stable`

```bash
git checkout stable
git pull
git tag -a 27.1.0 -m "27.1.0"
git push origin 27.1.0
```

`release.yml` builds, boots the server as a smoke test, and publishes a release marked **Latest**.

### 5. Open the next cycle on `dev`

This happens immediately after the merge. If `dev` equals `stable`, the next release PR is blocked.

```bash
git checkout dev
git merge stable
npm version preminor --preid=beta --no-git-tag-version
git commit -am "Open 27.2.0"
git push
```

`preminor` gives `27.2.0-beta.0`. The `.0` is correct. It is never tagged, and means "27.2.0, nothing published yet". The first `npm version prerelease --preid=beta` then produces `beta.1`, which is genuinely the first published beta.

`prepatch` is used instead when the next cycle is a patch (`27.1.1-beta.0`).

---

## Release notes

`release/<line>/` holds what Settings → Version shows:

```
release/27/
  release.json    { "codename": "Cascade", "released": "2026-07-27", "icon": "icon.png" }
  notes.md        prose shown under the version rows, no heading
  icon.png        the badge, 256px and under 500 KB
```

The folder is resolved from `package.json`, most specific first: `27.1.0`, then `27.1`, then `27`. **One folder per major line is the normal case**, because the panel describes the line while per-patch detail belongs in `CHANGELOG.md`. `release/27.2/` is added only when a minor deserves its own description.

`notes.md` should not start with a `#` heading; the name, version and codename are already displayed above it.

Editing these against a running server needs a page refresh, not a restart.

---

## When something fails

| Message | What happened | Fix |
| --- | --- | --- |
| `Tag 27.1.0-beta.3 does not match package.json version 27.1.0-beta.2` | A tag was created by hand without bumping, or the version was bumped without re-tagging. | Delete the tag, bump with `npm version`, re-tag. |
| `points at a commit that is not on stable` | A release was tagged on `dev`. | Merge into `stable` first, then tag from there. |
| `no release folder for 27.2.0` | The version was bumped but `release/<line>/` does not exist. | Create the folder, or the version panel renders blank. |
| `CHANGELOG.md still says "## [27.1.0]..."` | Releasing with an unfinished changelog. | Replace `TBD` in that heading with the release date. |
| `icon.png is 5.1 MB` | An unresized image. | Resize to 256px: `ffmpeg -i src.png -vf "scale=256:256:flags=lanczos" -y release/27/icon.png` |
| `package.json version must be bumped` | A PR into `stable` that does not raise the version. | Bump on `dev`, push, and update the PR. |
| `npm version` reports the working directory is not clean | Uncommitted changes. | Commit them first. |
| Bumped and tagged, but nothing appears on GitHub | `npm version` already committed, so `git status` looks clean. | `git push --follow-tags` |

---

## What CI checks

| Workflow | Runs on | Checks |
| --- | --- | --- |
| `ci.yml` | push/PR to `dev`, `stable` | lint, build, i18n, smoke, `check:release`, client and server tests |
| `version-guard.yml` | PR into `stable` | version is strictly newer, via `check-version-bump.mjs` |
| `prerelease.yml` | tag `*-beta.*` | tag matches `package.json` exactly, tag is on `dev` or `stable`, `check:release` |
| `release.yml` | tag `27.1.0` | tag matches `package.json` exactly, **tag is on `stable`**, `check:release`, server boots |

Version comparison uses `check-version-bump.mjs`, not `sort -V`. `sort -V` ranks `27.2.0-beta.5` above `27.2.0`, which would reject the exact PR that ships a release.

---

## Quick reference

| Step | Command | Version after | Tag |
| --- | --- | --- | --- |
| Work | `git commit` | unchanged | none |
| Publish a beta | `npm version prerelease --preid=beta` then `git push --follow-tags` | `27.1.0-beta.3` | `27.1.0-beta.3` |
| Prep the release | `npm version patch --no-git-tag-version`, commit, push, PR into `stable` | `27.1.0` | none |
| Tag the release | on `stable`: `git tag -a 27.1.0 -m "27.1.0"` then `git push origin 27.1.0` | `27.1.0` | `27.1.0` |
| Open next cycle | on `dev`: `npm version preminor --preid=beta --no-git-tag-version`, commit | `27.2.0-beta.0` | none |

Only the root `package.json` version matters. `client/package.json` and `server/package.json` carry a version that nothing reads. `server/lib/appversion.js` reads the root, and `npm version` only updates the root.
