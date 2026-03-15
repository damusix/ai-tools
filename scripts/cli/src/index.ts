import { parse } from "@bomb.sh/args";

const args = parse(process.argv.slice(2));
const command = args._[0];

if (!command) {
    console.log("Usage: pnpm dev <command> [args]");
    console.log("");
    console.log("Commands:");
    console.log("  version    Bump plugin versions and generate changelogs");
    console.log("  changelog  Regenerate changelogs from git history");
    process.exit(0);
}

if (command === "version") {
    const { run } = await import("./commands/version.js");
    await run(args._.slice(1));
} else if (command === "changelog") {
    const { run } = await import("./commands/changelog.js");
    run(args._.slice(1));
} else {
    console.error(`Unknown command: ${command}`);
    console.log("Available commands: version, changelog");
    process.exit(1);
}
