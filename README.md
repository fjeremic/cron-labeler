# Cron Pull Request Labeler

Cron pull request labeler is an extension of [actions/labeler](https://github.com/actions/labeler) which triages PRs based on the paths that are modified in the PR using a periodic cron job.

The [actions/labeler](https://github.com/actions/labeler) GitHub Action runs into the following issue (further described in [actions/labeler#12](https://github.com/actions/labeler/issues/12)) when the check runs on a pull request originating from a _forked_ repository:

```
##[error] HttpError: Resource not accessible by integration
##[error] Resource not accessible by integration
##[error] Node run failed with exit code 1
```

This is a fairly restrictive limitation in the GitHub Pull Request Workflow which many open source projects follow.

This project circumvents this limitation by running the GitHub Action as a cron job on the target repository. The cron job continuously monitors the pull requests of the target repository and adds the appropriate labels in a rate limiting aware manner with pagination support. The idea is that if this action is run often enough it will keep labeling the most recently updated pull requests, and eventually all pull requests will have been labeled.

## Usage

### Create `.github/labeler.yml`

Create a `.github/labeler.yml` file with a list of labels and [minimatch](https://github.com/isaacs/minimatch) globs to match to apply the label.

The key is the name of the label in your repository that you want to add (eg: "merge conflict", "needs-updating") and the value is the path (glob) of the changed files (eg: `src/**/*`, `tests/*.spec.js`)

#### Basic Examples

```yml
# Add 'label1' to any changes within 'example' folder or any subfolders
label1:
  - example/**/*

# Add 'label2' to any file changes within 'example2' folder
label2: example2/*
```

#### Common Examples

```yml
# Add 'repo' label to any root file changes
repo:
  - ./*
  
# Add '@domain/core' label to any change within the 'core' package
@domain/core:
  - package/core/*
  - package/core/**/*

# Add 'test' label to any change to *.spec.js files within the source dir
test:
  - src/**/*.spec.js
```

### Create Workflow

Create a workflow (eg: `.github/workflows/labeler.yml` see [Creating a Workflow file](https://help.github.com/en/articles/configuring-a-workflow#creating-a-workflow-file)) to utilize the labeler action running every 10 minutes:

```
name: "Cron Pull Request Labeler"
on:
  schedule:
  - cron: "*/10 * * * *"

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
    - uses: fjeremic/cron-labeler@0.1.0
      with:
        repo-token: ${{ secrets.GITHUB_TOKEN }}
```

_Note: This grants access to the `GITHUB_TOKEN` so the action can make calls to GitHub's rest API._
