import { getEncoding } from 'js-tiktoken';

const enc = getEncoding('cl100k_base');

export function countTokens(text: string): number {
    return enc.encode(text).length;
}
