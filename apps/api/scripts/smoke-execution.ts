import { execute, outputMatches } from "../src/execution.js";

const cases = [
  { language: "PYTHON", source: "print(input())" },
  { language: "C", source: "#include <stdio.h>\nint main(void) { char value[64]; if (fgets(value, sizeof(value), stdin)) printf(\"%s\", value); return 0; }" },
  { language: "CPP", source: '#include <iostream>\n#include <string>\nint main() { std::string value; std::getline(std::cin, value); std::cout << value << "\\n"; }' },
  { language: "JAVA", source: "import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner scanner = new Scanner(System.in); System.out.println(scanner.nextLine()); } }" },
] as const;

for (const testCase of cases) {
  const result = await execute(testCase.source, testCase.language, "runner-ok\n");
  if (result.statusId !== 3 || !outputMatches(result.stdout, "runner-ok")) {
    throw new Error(`${testCase.language} failed: ${result.status}; ${result.stderr || result.stdout}`);
  }
  console.log(`${testCase.language}: passed`);
}
