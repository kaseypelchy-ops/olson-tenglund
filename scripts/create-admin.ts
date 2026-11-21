import { emitKeypressEvents, type Key } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { betterAuth } from "better-auth";
import { getLibsqlClient } from "../db/connection";
import { createAuthOptions } from "../lib/auth-config";

class BootstrapError extends Error {}

function hiddenInput(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) throw new BootstrapError("Run this command in an interactive terminal. Passwords are entered privately, never as command arguments.");
  stdout.write(label);
  emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function finish() {
      stdin.removeListener("keypress", onKey);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
    }
    function onKey(text: string | undefined, key: Key) {
      if (key.ctrl && key.name === "c") {
        value = "";
        finish();
        reject(new BootstrapError("Account creation cancelled."));
      } else if (key.name === "return" || key.name === "enter") {
        finish();
        resolve(value);
        value = "";
      } else if (key.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
      } else if (!key.ctrl && !key.meta && text && !/[\u0000-\u001f\u007f]/.test(text)) {
        value += text;
      }
    }
    stdin.on("keypress", onKey);
  });
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) throw new BootstrapError("Run npm run admin:create in an interactive terminal. Piped passwords and command-line passwords are not accepted.");
  if (process.argv.length > 2) throw new BootstrapError("This command accepts no arguments. It prompts for the account details privately.");
  const client = getLibsqlClient();
  let password = "";
  let confirmation = "";
  try {
    const runtimeOptions = createAuthOptions(client);
    stdout.write("\nOlson & Tenglund — create a staff administrator\nThis creates a new account; it never changes an existing account.\n\n");
    const questions = createInterface({ input: stdin, output: stdout });
    let name: string;
    let email: string;
    try {
      name = (await questions.question("Full name: ")).trim();
      email = (await questions.question("Email address: ")).trim().toLowerCase();
    } finally {
      questions.close();
    }
    if (!name || name.length > 100) throw new BootstrapError("Enter a name between 1 and 100 characters.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new BootstrapError("Enter a valid email address.");
    const existing = await client.execute({ sql: "SELECT id FROM auth_user WHERE lower(email) = ? LIMIT 1", args: [email] });
    if (existing.rows.length) throw new BootstrapError("An account with that email already exists. No account was changed.");
    password = await hiddenInput("Password (12–128 characters; hidden): ");
    if (password.length < 12 || password.length > 128) throw new BootstrapError("Use a password between 12 and 128 characters.");
    confirmation = await hiddenInput("Confirm password (hidden): ");
    if (password !== confirmation) throw new BootstrapError("The passwords did not match. No account was created.");
    confirmation = "";

    // This instance is local to the CLI process. It is never imported by a web
    // route, and there is no runtime flag that enables public registration.
    // The privileged role is a server-owned default, not request body input.
    const bootstrapAuth = betterAuth({
      ...runtimeOptions,
      emailAndPassword: { ...runtimeOptions.emailAndPassword, disableSignUp: false, autoSignIn: false },
      user: {
        ...runtimeOptions.user,
        additionalFields: {
          ...runtimeOptions.user.additionalFields,
          role: { ...runtimeOptions.user.additionalFields.role, defaultValue: "admin" },
        },
      },
    });
    const result = await bootstrapAuth.api.signUpEmail({ body: { name, email, password } });
    password = "";
    const saved = await client.execute({ sql: "SELECT id, role FROM auth_user WHERE email = ?", args: [email] });
    if (saved.rows.length !== 1 || saved.rows[0].id !== result.user.id || saved.rows[0].role !== "admin") {
      throw new BootstrapError("Account creation could not be verified. Inspect the auth_user table before retrying.");
    }
    stdout.write("\nStaff administrator created. Sign in at /login using the email and password you entered.\nNo password or session token was printed or saved to a file.\n");
  } finally {
    password = "";
    confirmation = "";
    client.close();
  }
}

main().catch((error: unknown) => {
  // Database connection strings, secrets, hashes and passwords must not appear
  // in CLI error output. Detailed database setup is documented in the README.
  console.error(error instanceof BootstrapError ? error.message : "Account creation failed. Check the environment settings, database connection and applied migrations, then try again.");
  process.exitCode = 1;
});
