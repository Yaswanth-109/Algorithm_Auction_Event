import { execFileSync, spawn } from "node:child_process";
import os from "node:os";

const isPrivateIPv4 = (address) =>
  /^10\./.test(address) ||
  /^192\.168\./.test(address) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(address);

function windowsLanAddresses() {
  const command = [
    "$adapters = Get-NetAdapter -Physical | Where-Object Status -eq 'Up';",
    "foreach ($adapter in $adapters) {",
    "Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |",
    "ForEach-Object { $_.IPAddress }",
    "}",
  ].join(" ");

  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const addresses = output.split(/\s+/).filter((address) => isPrivateIPv4(address));
    if (addresses.length) return [...new Set(addresses)];
  } catch {}

  try {
    const output = execFileSync("ipconfig.exe", [], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const sections = output.split(/(?=^[^\r\n]*adapter [^\r\n]*:\s*$)/gim);
    const addresses = sections
      .filter((section) => !/adapter\s+(?:.*\b)?(?:WSL|vEthernet|Hyper-V|Virtual|Bluetooth|Local Area Connection\s*\*)/i.test(section.split(/\r?\n/, 1)[0] ?? ""))
      .flatMap((section) => [...section.matchAll(/IPv4[^:]*:\s*([\d.]+)/gi)].map((match) => match[1]));
    const usable = addresses.filter(isPrivateIPv4);
    if (usable.length) return [...new Set(usable)];
  } catch {}
  return [];
}

function lanAddresses() {
  const runningInWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || process.env.WSLENV || os.release().toLowerCase().includes("microsoft"));
  if (runningInWsl) return windowsLanAddresses();
  if (process.platform === "win32") return windowsLanAddresses();

  const addresses = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/docker|veth|virtual|loopback/i.test(name))
    .flatMap(([, entries]) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal && isPrivateIPv4(entry.address))
    .map((entry) => entry.address);
  return [...new Set(addresses)];
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let activeAddresses = [];
let activeKey = "";
let pendingAddresses;
let child;
let restartTimer;
let shuttingDown = false;

function stopServices(signal) {
  if (!child) return;
  if (process.platform === "win32") {
    child.kill(signal);
    try {
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
    return;
  }

  // npm starts Next.js and the API as descendants. In WSL/Linux they share
  // this detached process group, so stop the whole group before restarting.
  try { process.kill(-child.pid, signal); }
  catch { child.kill(signal); }
}

function startServices(addresses) {
  activeAddresses = addresses;
  activeKey = addresses.join(",");
  const selectedAddress = addresses[0];
  const childEnv = { ...process.env };

  if (selectedAddress) {
    childEnv.WEB_ORIGIN = `http://${selectedAddress}:3000`;
    childEnv.WEB_ORIGINS = [...new Set([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      ...addresses.map((address) => `http://${address}:3000`),
    ])].join(",");
    childEnv.NEXT_PUBLIC_API_URL = `http://${selectedAddress}:4000`;
    childEnv.NEXT_PUBLIC_DYNAMIC_API_HOST = "true";
    console.log("\nAlgorithm Auction network addresses");
    console.log("  Open on this computer: http://localhost:3000");
    for (const address of addresses) console.log(`  Open on another device: http://${address}:3000`);
    console.log(`  API readiness check:   http://${selectedAddress}:4000/api/ready`);
    console.log("  Keep this terminal open. Devices must be on a network that can reach this computer.\n");
  } else {
    console.warn("Could not detect a LAN IPv4 address. Check your network; using the URLs from .env.\n");
  }

  const spawnOptions = { stdio: "inherit", env: childEnv, shell: process.platform === "win32" };
  if (process.platform !== "win32") spawnOptions.detached = true;
  child = spawn(npm, ["run", "dev:services"], spawnOptions);
  child.on("exit", (code) => {
    const childPid = child?.pid;
    child = undefined;
    if (shuttingDown) {
      process.exit(0);
      return;
    }
    if (pendingAddresses) {
      // Let the npm/concurrently descendants release both listening ports.
      restartTimer = setTimeout(() => {
        restartTimer = undefined;
        const nextAddresses = pendingAddresses ?? activeAddresses;
        pendingAddresses = undefined;
        if (!shuttingDown) startServices(nextAddresses);
      }, 750);
      return;
    }
    if (code && process.platform !== "win32") {
      try { if (childPid) process.kill(-childPid, "SIGTERM"); } catch {}
    }
    process.exitCode = code ?? 1;
    clearInterval(networkWatcher);
  });
  child.on("error", (error) => {
    console.error("Could not start the web and API services:", error.message);
    shuttingDown = true;
    clearInterval(networkWatcher);
    process.exitCode = 1;
  });
}

function checkNetworkAddress() {
  const addresses = lanAddresses().sort();
  if (!addresses.length || addresses.join(",") === activeKey) return;
  pendingAddresses = addresses;
  if (child) {
    console.log("\nNetwork address changed. Restarting web and API with the new address...");
    stopServices("SIGTERM");
  } else if (!shuttingDown && !restartTimer) {
    const nextAddresses = pendingAddresses;
    pendingAddresses = undefined;
    startServices(nextAddresses);
  }
}

startServices(lanAddresses().sort());
const networkWatcher = setInterval(checkNetworkAddress, 5_000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shuttingDown = true;
    clearInterval(networkWatcher);
    if (restartTimer) clearTimeout(restartTimer);
    if (child) stopServices(signal);
    else process.exit(0);
  });
}
