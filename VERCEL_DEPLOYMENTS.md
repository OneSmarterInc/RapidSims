# Selective Vercel builds

Each of the 13 app folders has its own `vercel.json` ignoreCommand. Keep each
Vercel project's Root Directory pointed at its app folder. The command uses Git
paths anchored at the repository root, so it also works from a subdirectory.
No dependencies need installing to run the command.

The comparison is from VERCEL_GIT_PREVIOUS_SHA (the last successful deployment
for this project and branch) to HEAD, rather than just the last commit. Exit 0
skips; any other exit code builds. Own-folder changes, root dependency/toolchain
configuration, and shared/ or packages/ changes build the project. Sim04 also
watches the four platform files read by its build gate. Platform routing to a
sim's URL does not itself require rebuilding the platform when that sim changes.
New shared imports must be added to the consuming project's watched paths.

First deployments, unavailable history (including shallow clones), Git errors,
and explicit redeployments of the same commit build conservatively. Enable
Vercel's automatic system environment variable exposure; if the previous SHA
is unavailable the safe result is a build. VERCEL_FORCE_BUILD=1 also forces a
build, or uncheck "Use project's Ignore Build Step" for a dashboard redeploy.
Environment-only updates require an explicit redeploy.

The initial rollout changes all 13 configurations and can build all connected
projects once. Subsequent unrelated changes should show canceled/skipped builds.
Ignored Build Step still uses deployment/concurrency capacity; it is not the
workspace-based feature that prevents deployment creation entirely.

Validation: `python3 tools/test-vercel-ignore.py` runs the actual configured
commands against temporary Git repositories, including multi-commit changes,
shared dependencies, first deployments, unavailable commits, and renames.
