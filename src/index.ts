import * as core from "@actions/core";
import * as github from "@actions/github";
import * as yaml from "js-yaml";
import { Minimatch } from "minimatch";
import { Octokit } from "@octokit/rest";

type Pull = Octokit.PullsListResponseItem;
type PullLabel = Octokit.PullsListResponseItemLabelsItem;

interface Args {
  repoToken: string;
  configurationPath: string;
  skipLabeledPrs: boolean;
  operationsPerRun: number;
}

async function run(): Promise<void> {
  try {
    const args = getAndValidateArgs();

    const client = new github.GitHub(args.repoToken);

    const contents: any = await client.repos.getContents({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      path: args.configurationPath,
      ref: github.context.sha
    });

    args.operationsPerRun -= 1;

    const configurationContent: string = Buffer.from(
      contents.data.content,
      contents.data.encoding
    ).toString();

    // loads (hopefully) a `{[label:string]: string | string[]}`, but is `any`:
    const configObject: any = yaml.safeLoad(configurationContent);

    // transform `any` => `Map<string,string[]>` or throw if yaml is malformed:
    const labelGlobs: Map<string, string[]> = new Map();
    for (const label in configObject) {
      if (typeof configObject[label] === "string") {
        labelGlobs.set(label, [configObject[label]]);
      } else if (configObject[label] instanceof Array) {
        labelGlobs.set(label, configObject[label]);
      } else {
        throw Error(
          `found unexpected type for label ${label} (should be string or array of globs)`
        );
      }
    }

    await processPrs(client, labelGlobs, args, args.operationsPerRun);
  } catch (error) {
    console.log(error.message);
    console.log(error.stack);

    core.setFailed(error.message);
  }
}

async function processPrs(
  client: github.GitHub,
  labelGlobs: Map<string, string[]>,
  args: Args,
  operationsLeft: number,
  page: number = 1
): Promise<number> {
  const prs = await client.pulls.list({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    state: "open",
    sort: "updated",
    direction: "desc",
    per_page: 100,
    page
  });

  operationsLeft -= 1;

  if (prs.data.length === 0 || operationsLeft === 0) {
    return operationsLeft;
  }

  for (const pr of prs.data.values()) {
    console.log(`found pr #${pr.number}: ${pr.title}`);

    if (args.skipLabeledPrs && pr.labels.length > 0) {
      console.log(`skipping pr #${pr.number} since it has labels already`);
      continue;
    }

    console.log(`fetching changed files for pr #${pr.number}`);

    const listFilesResponse = await client.pulls.listFiles({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: pr.number
    });

    operationsLeft -= 1;

    const changedFiles = listFilesResponse.data.map(f => f.filename);

    console.log("found changed files:");
    for (const file of changedFiles) {
      console.log("  " + file);
    }

    const labels: string[] = [];
    for (const [label, globs] of labelGlobs.entries()) {
      console.log(`processing label ${label}`);
      if (checkGlobs(changedFiles, globs)) {
        labels.push(label);
      }
    }

    if (labels.length > 0) {
      if (!labels.every(label => isLabeled(pr, label))) {
        console.log(`adding labels ${labels}`);

        await client.issues.addLabels({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          issue_number: pr.number,
          labels: labels
        });

        operationsLeft -= 1;
      }
    }

    if (operationsLeft <= 0) {
      core.warning(
        `performed ${args.operationsPerRun} operations, exiting to avoid rate limit`
      );
      return 0;
    }
  }

  return await processPrs(client, labelGlobs, args, operationsLeft, page + 1);
}

function isLabeled(pr: Pull, label: string): boolean {
  const labelComparer: (l: PullLabel) => boolean = l =>
    label.localeCompare(l.name, undefined, { sensitivity: "accent" }) === 0;
  return pr.labels.filter(labelComparer).length > 0;
}

function checkGlobs(changedFiles: string[], globs: string[]): boolean {
  for (const glob of globs) {
    const matcher = new Minimatch(glob);
    for (const changedFile of changedFiles) {
      if (matcher.match(changedFile)) {
        console.log(`  - ${changedFile} matches glob ${glob}`);
        return true;
      }
    }
  }

  return false;
}

function getAndValidateArgs(): Args {
  const args = {
    repoToken: core.getInput("repo-token", { required: true }),
    configurationPath: core.getInput("configuration-path"),
    skipLabeledPrs: core.getInput("skip-labeled-prs", { required: true }) === 'true',
    operationsPerRun: parseInt(
      core.getInput("operations-per-run", { required: true })
    )
  };

  for (const numberInput of ["operations-per-run"]) {
    if (isNaN(parseInt(core.getInput(numberInput)))) {
      throw Error(`input ${numberInput} did not parse to a valid integer`);
    }
  }

  return args;
}

run();
