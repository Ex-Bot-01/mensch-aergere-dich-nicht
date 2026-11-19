import { CODE_ALPHABET, CODE_LEN } from '@madn/shared';

/** A room code a person can read out over the phone without spelling it twice. */
export function newCode(rand: () => number): string {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    const pick = Math.min(CODE_ALPHABET.length - 1, Math.floor(rand() * CODE_ALPHABET.length));
    code += CODE_ALPHABET[pick];
  }
  return code;
}
