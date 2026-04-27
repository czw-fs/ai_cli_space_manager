import { commandTemplateForApplication, nameFromApplicationPath } from "../src/openerCommand";

function assertEqual(actual: string, expected: string, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

assertEqual(
  commandTemplateForApplication(String.raw`C:\dev\app\IntelliJ IDEA 2025.2.4\bin\idea64.exe`),
  String.raw`"C:\dev\app\IntelliJ IDEA 2025.2.4\bin\idea64.exe"`,
  "application command should not append the workspace path placeholder",
);

assertEqual(
  nameFromApplicationPath(String.raw`C:\dev\app\IntelliJ IDEA 2025.2.4\bin\idea64.exe`),
  "idea64",
  "application name should be derived from the executable filename",
);
