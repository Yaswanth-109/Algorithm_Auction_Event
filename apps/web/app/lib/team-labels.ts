function letterFor(index: number) {
  let value = index;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function teamIndex(code: string, name?: string) {
  const codeMatch = code.match(/^TEAM-(\d+)$/i);
  const nameMatch = name?.match(/^Team\s+(\d+)$/i);
  const number = Number(codeMatch?.[1] ?? nameMatch?.[1]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function teamDisplayName(code: string, name?: string) {
  const index = teamIndex(code, name);
  return index === null ? (name ?? code) : `Team ${letterFor(index)}`;
}

export function teamDisplayCode(code: string, name?: string) {
  const index = teamIndex(code, name);
  return index === null || !/^TEAM-\d+$/i.test(code) ? code : `TEAM-${letterFor(index)}`;
}
