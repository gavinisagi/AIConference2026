import type { Locale } from './locale';
import { zh } from './dictionaries/zh';
import { en } from './dictionaries/en';
import type { Dictionary } from './dictionaries/zh';

export function getDictionary(locale: Locale): Dictionary {
  return locale === 'en' ? en : zh;
}

export type { Dictionary };
