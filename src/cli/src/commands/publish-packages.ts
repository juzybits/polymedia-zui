import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

import * as TOML from "@iarna/toml";
import { SuiObjectChange } from "@mysten/sui/client";

import { setupSuiTransaction } from "@polymedia/suitcase-node";

import { log, error } from "../logger.js";

/// Package name must be in PascalCase and named address must be in snake_case in Move.toml
/// Example: name = "AccountExtensions" -> "account_extensions" = "0x0"

type Package = {
    name: string;
    path: string;
    dependencies: string[];
    published?: boolean;
};

export class PackagePublisher {
    private readonly packages: Map<string, Package>;

    constructor() {
        this.packages = new Map();
    }

    private async confirmPublish(): Promise<boolean> {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise<boolean>((resolve) => {
            log("\x1b[33m\nWARNING: Publishing packages will delete Move.lock files and previously published data will be lost.\x1b[0m");
            rl.question("Are you sure you want to continue? (y/n): ", (answer: string) => {
                rl.close();
                resolve(answer.toLowerCase() === "y");
            });
        });
    }

    private findMoveTomls(dir: string): string[] {
        const results: string[] = [];
        const items = fs.readdirSync(dir, { withFileTypes: true });

        for (const item of items) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
                results.push(...this.findMoveTomls(fullPath));
            } else if (item.name === "Move.toml") {
                results.push(fullPath);
            }
        }

        return results;
    }

    public loadPackages(packagesRoot: string) {
        const moveTomlPaths = this.findMoveTomls(packagesRoot);

        for (const moveTomlPath of moveTomlPaths) {
            const content = fs.readFileSync(moveTomlPath, "utf8");
            const parsed = TOML.parse(content);

            if (!(parsed.package as any).name) continue;

            const dependencies: string[] = [];
            if (parsed.dependencies) {
                for (const [depName, depInfo] of Object.entries(parsed.dependencies)) {
                    if (typeof depInfo === "object" && "local" in depInfo) {
                        dependencies.push(depName);
                    }
                }
            }
            this.packages.set((parsed.package as any).name, {
                name: (parsed.package as any).name,
                path: path.dirname(moveTomlPath),
                dependencies,
                published: false
            });
        }
    }

    private getPublishOrder(): string[] {
        const visited = new Set<string>();
        const order: string[] = [];

        const visit = (packageName: string) => {
            if (visited.has(packageName)) return;
            visited.add(packageName);

            const pkg = this.packages.get(packageName);
            if (!pkg) return;

            for (const dep of pkg.dependencies) {
                visit(dep);
            }
            order.push(packageName);
        };

        for (const packageName of this.packages.keys()) {
            visit(packageName);
        }

        return order;
    }

    private executeSuiCommand(args: string[], options: { captureOutput?: boolean } = {}): string {
        const buildCmd = ["sui", ...args];

        const result = spawnSync(buildCmd[0], buildCmd.slice(1), {
            stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
            encoding: "utf8"
        });

        if (result.status !== 0) {
            error("Sui command failed with status", result.status);
            if (result.stderr) error(result.stderr);
            process.exit(1);
        }

        return options.captureOutput ? result.stdout : "";
    }

    private async publishPackage(packageInfo: Package, createdObjDir?: string): Promise<string> {
        log(`\n📦 Publishing package: ${packageInfo.name}`);

        // Delete Move.lock
        const moveLockPath = path.join(packageInfo.path, "Move.lock");
        if (fs.existsSync(moveLockPath)) {
            fs.unlinkSync(moveLockPath);
            log("Deleted Move.lock file");
        }

        // Update Move.toml
        const moveTomlPath = path.join(packageInfo.path, "Move.toml");
        const namedAddress = packageInfo.name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

        const moveTomlContent = fs.readFileSync(moveTomlPath, "utf8");
        const parsedToml = TOML.parse(moveTomlContent);

        if (!parsedToml.addresses) {
            error(`${packageInfo.name} Move.toml does not contain addresses section`);
            process.exit(1);
        }
        // change named address to 0x0 before publish
        (parsedToml.addresses as any)[namedAddress] = "0x0";
        fs.writeFileSync(moveTomlPath, TOML.stringify(parsedToml));

        // Build package
        log("Building package...");
        const buildOutput = this.executeSuiCommand(
            ["move", "build", "--dump-bytecode-as-base64", "--path", packageInfo.path],
            { captureOutput: true }
        );
        const { modules, dependencies } = JSON.parse(buildOutput);
        // load network and signer from environment
        const { network, client, tx, signer } = await setupSuiTransaction();
        const sender = signer.toSuiAddress();
        log("Active network", network);
        log("Active address", sender);
        
        // Publish package
        log("Publishing...");
        const [upgradeCap] = tx.publish({ modules, dependencies });
        tx.transferObjects([upgradeCap], sender);

        const result = await client.signAndExecuteTransaction({
            signer,
            transaction: tx,
            options: {
                showObjectChanges: true,
                showEffects: true,
            },
            requestType: "WaitForLocalExecution"
        });

        if (result.effects?.status?.status !== "success") {
            error(`Publish failed: ${result.effects?.status?.error}`);
            process.exit(1);
        }

        const packageId = result.objectChanges?.find((item: SuiObjectChange) => item.type === "published")?.packageId;

        if (!packageId) {
            error("Could not find package ID in publish result");
            process.exit(1);
        }

        // Save publish info
        const objects = result.objectChanges!.map((item: SuiObjectChange) => ({
            type: item.type === "published" ? packageInfo.name : item.objectType,
            id: item.type === "published" ? item.packageId : item.objectId
        }));

        if (createdObjDir) {
            if (!fs.existsSync(createdObjDir)) {
                fs.mkdirSync(createdObjDir, { recursive: true });
            }
            fs.writeFileSync(
                `${createdObjDir}/${namedAddress.replace("_", "-")}.json`,
                JSON.stringify(objects, null, 2)
            );
            log(`Created objects saved to ${createdObjDir}/${namedAddress.replace("_", "-")}.json`);
        };

        // Update Move.lock
        this.executeSuiCommand([
            "move", "manage-package",
            "--environment", this.executeSuiCommand(["client", "active-env"], { captureOutput: true }).trim(),
            "--network-id", this.executeSuiCommand(["client", "chain-identifier"], { captureOutput: true }).trim(),
            "--original-id", packageId,
            "--latest-id", packageId,
            "--version-number", "1",
            "--path", packageInfo.path
        ]);

        // Update Move.toml files (both the package itself and its dependents)
        for (const pkg of this.packages.values()) {
            // Skip if it's not the package itself and doesn't depend on it
            if (pkg.name !== packageInfo.name && !pkg.dependencies.includes(packageInfo.name)) {
                continue;
            }

            const pkgMoveToml = path.join(pkg.path, "Move.toml");
            const content = fs.readFileSync(pkgMoveToml, "utf8");
            const parsed = TOML.parse(content);

            if (parsed.addresses && typeof parsed.addresses === "object") {
                (parsed.addresses as Record<string, string>)[namedAddress] = packageId;
                fs.writeFileSync(pkgMoveToml, TOML.stringify(parsed));
                log(`Updated ${pkg.name}'s Move.toml with ${packageInfo.name}'s address`);
            }
        }

        log("\x1b[32m" + `\n✅ Successfully published ${packageInfo.name} at: ${packageId}` + "\x1b[0m");
        return packageId;
    }

    public async publishAll(createdObjDir?: string): Promise<boolean> {
        if (this.packages.size === 0) {
            log("Packages not loaded");
            return false;
        }

        const confirmed = await this.confirmPublish();
        if (!confirmed) {
            log("Publish cancelled");
            return false;
        }

        const order = this.getPublishOrder();
        log("\n📋 Publish order:", order.join(" → "));

        for (const packageName of order) {
            const pkg = this.packages.get(packageName)!;
            try {
                await this.publishPackage(pkg, createdObjDir);
                pkg.published = true;
            } catch (error) {
                console.error(`\n❌ Failed to publish ${packageName}:`, error);
                break;
            }
        }

        const successful = Array.from(this.packages.values()).filter(p => p.published).map(p => p.name);
        const failed = Array.from(this.packages.values()).filter(p => !p.published).map(p => p.name);

        log("\n📊 Publish Summary:");
        if (successful.length > 0) {
            log("✅ Successfully published:", successful.join(", "));
        }
        if (failed.length > 0) {
            log("❌ Failed to publish:", failed.join(", "));
            return false;
        }

        return true;
    }
}