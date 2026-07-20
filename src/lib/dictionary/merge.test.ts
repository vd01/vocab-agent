/**
 * mergeMultiple unit tests
 */
import { describe, it, expect } from 'vitest';
import { mergeMultiple } from './merge';
import type { DictEntry } from './types';

describe('mergeMultiple', () => {
	it('returns null when all sources return null', () => {
		expect(mergeMultiple([null, null])).toBeNull();
	});

	it('returns the single valid result', () => {
		const entry: Partial<DictEntry> = {
			word: 'test',
			phonetic: '/tɛst/',
			translation: '测试',
			definitions: [],
			collins: 4,
			tag: 'cet4',
			bnc: 500,
			frq: 200,
			exchange: null,
			audioUrl: null,
			synonyms: [],
			antonyms: [],
			origin: null,
			source: 'ecdict',
		};
		const result = mergeMultiple([entry, null]);
		expect(result).not.toBeNull();
		expect(result!.word).toBe('test');
		expect(result!.phonetic).toBe('/tɛst/');
		expect(result!.translation).toBe('测试');
		expect(result!.source).toBe('ecdict');
	});

	it('first source wins for conflicting fields', () => {
		const api: Partial<DictEntry> = {
			word: 'test',
			phonetic: '/tɛst/',
			translation: '',
			definitions: [
				{
					partOfSpeech: 'noun',
					definitions: [{ definition: 'A procedure for critical evaluation' }],
				},
			],
			synonyms: ['exam', 'trial'],
			antonyms: [],
			origin: 'From Old French',
			source: 'freedict',
		};
		const ecdict: Partial<DictEntry> = {
			word: 'test',
			phonetic: 'test', // should NOT override API
			translation: '测试; 测验', // fills gap
			definitions: [
				{
					partOfSpeech: 'n.',
					definitions: [{ definition: 'examination' }],
				},
			], // should NOT override API
			collins: 4, // fills gap
			tag: 'cet4',
			bnc: 500,
			frq: 200,
			synonyms: [],
			antonyms: [],
			source: 'ecdict',
		};
		const result = mergeMultiple([api, ecdict]);
		expect(result).not.toBeNull();
		// API wins phonetic
		expect(result!.phonetic).toBe('/tɛst/');
		// API wins definitions
		expect(result!.definitions).toEqual(api.definitions);
		// ECDICT fills translation
		expect(result!.translation).toBe('测试; 测验');
		// ECDICT fills collins
		expect(result!.collins).toBe(4);
		// ECDICT fills tag
		expect(result!.tag).toBe('cet4');
		// API provides synonyms
		expect(result!.synonyms).toEqual(['exam', 'trial']);
		// API provides origin
		expect(result!.origin).toBe('From Old French');
		// Source combines both
		expect(result!.source).toBe('freedict+ecdict');
	});

	it('ECDICT only — definitions from ECDICT English defs', () => {
		const ecdict: Partial<DictEntry> = {
			word: 'happy',
			phonetic: 'ˈhæpi',
			translation: '高兴的; 快乐的',
			definitions: [
				{
					partOfSpeech: 'adj.',
					definitions: [
						{ definition: 'feeling or showing pleasure' },
						{ definition: 'fortunate; lucky' },
					],
				},
			],
			collins: 3,
			tag: null,
			bnc: null,
			frq: null,
			exchange: null,
			synonyms: [],
			antonyms: [],
			source: 'ecdict',
		};
		const result = mergeMultiple([ecdict, null]);
		expect(result).not.toBeNull();
		expect(result!.word).toBe('happy');
		expect(result!.phonetic).toBe('ˈhæpi');
		expect(result!.translation).toBe('高兴的; 快乐的');
		expect(result!.definitions).toHaveLength(1);
		expect(result!.definitions[0].definitions).toHaveLength(2);
		expect(result!.source).toBe('ecdict');
	});

	it('nulls in array are skipped', () => {
		const api: Partial<DictEntry> = {
			word: 'test',
			phonetic: '/t/',
			translation: 'n/a',
			definitions: [],
			source: 'freedict',
		};
		const result = mergeMultiple([null, null, api]);
		expect(result).not.toBeNull();
		expect(result!.source).toBe('freedict');
	});

	it('fills empty fields from later sources', () => {
		const first: Partial<DictEntry> = {
			word: 'word',
			phonetic: '',
			translation: '',
			definitions: [],
			source: 'freedict',
		};
		const second: Partial<DictEntry> = {
			word: 'word',
			phonetic: '/wɝd/',
			translation: '单词',
			definitions: [],
			collins: 5,
			tag: 'cet4 cet6',
			source: 'ecdict',
		};
		const result = mergeMultiple([first, second]);
		expect(result).not.toBeNull();
		// Empty phonetic from first is overwritten by second
		expect(result!.phonetic).toBe('/wɝd/');
		expect(result!.translation).toBe('单词');
		expect(result!.tag).toBe('cet4 cet6');
		expect(result!.source).toBe('freedict+ecdict');
	});
});
