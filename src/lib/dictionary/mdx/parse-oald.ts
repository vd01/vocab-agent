/**
 * OALD9 MDX HTML → structured MdxSense parser.
 *
 * Uses linkedom (lightweight DOM) instead of regex for reliable
 * nested-HTML parsing. OALD9 MDX uses custom semantic tags like
 * <def>, <chn>, <pos>, <sn-g>, etc. which map cleanly to
 * dictionary structure.
 *
 * This avoids the need for OALD9 CSS/JS — we parse into structured
 * JSON that the frontend renders with its own layout.
 */

import type { MdxSense } from '../types';
import { parseHTML } from 'linkedom';

// ── DOM helpers ──────────────────────────────────────────────────────────

/** Get text content of the first matching element, cleaned up. */
function textOf(parent: Element | DocumentFragment, tag: string): string {
	return (parent.querySelector(tag)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Get text content of all matching elements. */
function textAll(parent: Element | DocumentFragment, tag: string): string[] {
	return [...parent.querySelectorAll(tag)].map(el =>
		el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
	);
}

/** Get all direct children matching a tag (querySelectorAll includes nested). */
function childrenWithTag(parent: Element | DocumentFragment, tag: string): Element[] {
	return [...parent.children].filter(el => el.tagName.toLowerCase() === tag.toLowerCase());
}

// ── Sense extraction ─────────────────────────────────────────────────────

interface RawSense {
	number?: string;
	cf?: string;
	en: string;
	cn: string;
	examples: string[];
	synonym?: string;
	grammar?: string;
	register?: string;
	geo?: string;
}

function extractSensesFromSnGs(parent: Element | DocumentFragment): RawSense[] {
	const senses: RawSense[] = [];
	const snGs = [...parent.querySelectorAll('sn-g')];

	for (const snG of snGs) {
		const enRaw = textOf(snG, 'def');
		if (!enRaw) continue;

		// Separate English definition from embedded Chinese
		// OALD9 <def> often contains: "English definition 中文翻译"
		let en = enRaw;
		let cnFromDef = '';
		const cnBoundary = enRaw.search(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/);
		if (cnBoundary > 10) {
			en = enRaw.slice(0, cnBoundary).trim();
			cnFromDef = enRaw.slice(cnBoundary).trim();
		}

		// Chinese translation: prefer <chn> inside <def>, not <chn> inside <subj> or other tags
		const defEl = snG.querySelector('def');
		let cn = '';
		if (defEl) {
			const defChn = [...defEl.children].find(c => c.tagName?.toLowerCase() === 'chn');
			cn = defChn?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		}
		// Fallback: if no <chn> in <def>, use cnFromDef from text splitting
		if (!cn) cn = cnFromDef;
		// Last resort: any <chn> in snG (but skip ones inside <subj>)
		if (!cn) {
			const nonSubjChn = [...snG.querySelectorAll('chn')].find(ch => !ch.closest('subj, unbox, x'));
			cn = nonSubjChn?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		}
		const cf = textOf(snG, 'cf');
		let gram = textOf(snG, 'gram');
		let reg = textOf(snG, 'reg');
		const geo = textOf(snG, 'geo');

		// Clean up grammar: fix unclosed brackets, extract embedded register
		if (gram) {
			if (gram.startsWith('[') && !gram.includes(']')) gram = gram + ']';
			const regInGram = gram.match(/\(([^)]+)\)/);
			if (regInGram && !reg) {
				reg = regInGram[1];
				gram = gram.replace(/\([^)]+\)/, '').trim();
			}
			gram = gram.replace(/,\s*$/, '').replace(/\[\s*\]/, '').trim();
			if (!gram) gram = undefined as unknown as string;
		}
		if (reg && !reg.trim()) reg = undefined as unknown as string;

		// Sense number — only accept numeric sense numbers, not idiom text
		let number: string | undefined;
		const snBlk = textOf(snG, 'sn-blk');
		const snBlkNolist = textOf(snG, 'sn-blk-nolist');
		// sn-blk-nolist often contains idiom text, not a number
		if (snBlk && /^\d/.test(snBlk)) number = snBlk;
		else if (snBlkNolist && /^\d/.test(snBlkNolist)) number = snBlkNolist;

		// Skip senses that are actually idiom definitions (no number and inside idm-gs)
		// These are identified by having no numeric sense number
		if (!number && snG.closest('idm-gs, idm-g')) continue;

		// Examples — extract from <x> elements, clean up noise
		const xEls = [...snG.querySelectorAll('x')];
		const examples = xEls
			.map(el => {
				let cleaned = (el.textContent ?? '')
					.replace(/\s+/g, ' ')
					.replace(/^[◆▸➤▪🔑🔊]\s*/, '')
					.trim();
				// Remove leading grammar pattern like [transitive] or (formal)
				cleaned = cleaned.replace(/^\[[\s\S]*?\]\s*/, '').trim();
				cleaned = cleaned.replace(/^\([^)]+\)\s*/, '').trim();
				// Remove cf pattern at start (e.g. "~ sb")
				cleaned = cleaned.replace(/^~\s+\S+\s*/, '').trim();
				// Remove Chinese part after the English
				const cnStart = cleaned.search(/[\u4e00-\u9fff]/);
				if (cnStart > 10) cleaned = cleaned.slice(0, cnStart).trim();
				return cleaned;
			})
			.filter(ex => {
				if (!ex || ex.length < 10) return false;
				if (en.length > 20 && ex.includes(en.slice(0, 30))) return false;
				return true;
			})
			.slice(0, 2);

		// Cross-reference: look for SYN
		let synonym: string | undefined;
		const xrGs = [...snG.querySelectorAll('xr-g')];
		for (const xrG of xrGs) {
			const label = textOf(xrG, 'xrlabel');
			if (label.includes('SYN') || label.toLowerCase().includes('synonym')) {
				const xh = textOf(xrG, 'xh');
				if (xh) synonym = xh;
				else {
					const m = label.match(/SYN\s+(.+)/i);
					if (m) synonym = m[1].trim();
				}
			}
		}

		senses.push({
			number,
			cf: cf || undefined,
			en,
			cn,
			examples: examples.length > 0 ? examples : [],
			synonym,
			grammar: gram || undefined,
			register: reg || undefined,
			geo: geo || undefined,
		});
	}

	return senses;
}

// ── Idiom extraction ─────────────────────────────────────────────────────

function extractIdioms(parent: Element | DocumentFragment): MdxSense['idioms'] {
	const idmGs = [...parent.querySelectorAll('idm-g')];
	if (idmGs.length === 0) return undefined;

	const idioms: NonNullable<MdxSense['idioms']> = [];
	for (const idmG of idmGs) {
		const phrase = textOf(idmG, 'idm').replace(/^●\s*/, '').trim();
		let en = textOf(idmG, 'def');
		const cn = textOf(idmG, 'chn');
		// Separate English from embedded Chinese in def
		const cnBoundary = en.search(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/);
		if (cnBoundary > 10) {
			en = en.slice(0, cnBoundary).trim();
		}
		if (phrase && en) idioms.push({ phrase, en, cn });
	}
	return idioms.length > 0 ? idioms : undefined;
}

// ── Phrasal verb extraction ──────────────────────────────────────────────

function extractPhrasalVerbs(doc: DocumentFragment): MdxSense['phrasalVerbs'] {
	const pvGs = [...doc.querySelectorAll('pv-g')];
	if (pvGs.length === 0) return undefined;

	const pvs: NonNullable<MdxSense['phrasalVerbs']> = [];
	for (const pvG of pvGs) {
		const phrase = textOf(pvG, 'pv').replace(/^●\s*/, '').trim();
		if (!phrase) continue;

		const rawSenses = extractSensesFromSnGs(pvG);
		const senses = rawSenses.length > 0
			? rawSenses.map(rs => ({ en: rs.en, cn: rs.cn, examples: rs.examples }))
			: textAll(pvG, 'def').map((en, i) => ({
					en,
					cn: textAll(pvG, 'chn')[i] || '',
				}));

		if (senses.length > 0) pvs.push({ phrase, senses });
	}
	return pvs.length > 0 ? pvs : undefined;
}

// ── Derived form extraction ──────────────────────────────────────────────

function extractDerivedForms(doc: DocumentFragment): MdxSense['derivedForms'] {
	const drGs = [...doc.querySelectorAll('dr-g')];
	if (drGs.length === 0) return undefined;

	const forms: NonNullable<MdxSense['derivedForms']> = [];
	for (const drG of drGs) {
		const word = textOf(drG, 'h').trim();
		const pos = textOf(drG, 'pos').trim();
		if (word) forms.push({ word, pos: pos || undefined });
	}
	return forms.length > 0 ? forms : undefined;
}

// ── Main parser ──────────────────────────────────────────────────────────

/**
 * Parse OALD9 MDX HTML into structured MdxSense[].
 *
 * OALD9 structure:
 *   <div class="cixing_tiaozhuan"> → POS navigation links
 *   <div class="cixing_part" id="verb"> → per-POS section
 *     <subentry-g> → subentry (one per POS)
 *       <pos> → part of speech label
 *       <sn-gs> → sense group container
 *         <sn-g> → individual sense
 *           <sn-blk> → sense number
 *           <def> → English definition
 *           <chn> → Chinese translation
 *           <cf> → collocation pattern
 *           <gram> → grammar label
 *           <reg> → register label
 *           <x> → example sentence
 *           <xr-g> → cross-reference
 *       <idm-g> → idiom
 *       <pv-g> → phrasal verb (at entry level)
 *     <dr-g> → derived form
 */
export function parseOaldHtml(html: string): MdxSense[] {
	const { document } = parseHTML(html);
	const senses: MdxSense[] = [];

	// Strategy 1: Parse via subentry-g (standard OALD9 structure)
	const subentries = [...document.querySelectorAll('subentry-g')];

	for (const sub of subentries) {
		const pos = textOf(sub, 'pos');
		if (!pos) continue;

		let grammar = textOf(sub, 'gram');
		let register = textOf(sub, 'reg');
		const geo = textOf(sub, 'geo');

		// Clean up grammar at subentry level
		if (grammar) {
			if (grammar.startsWith('[') && !grammar.includes(']')) grammar = grammar + ']';
			const regInGram = grammar.match(/\(([^)]+)\)/);
			if (regInGram && !register) {
				register = regInGram[1];
				grammar = grammar.replace(/\([^)]+\)/, '').trim();
			}
			grammar = grammar.replace(/,\s*$/, '').replace(/\[\s*\]/, '').trim();
			if (!grammar) grammar = undefined as unknown as string;
		}
		if (register && !register.trim()) register = undefined as unknown as string;

		const rawSenses = extractSensesFromSnGs(sub);
		const limitedSenses = rawSenses.slice(0, 6).map(rs => ({
			number: rs.number,
			cf: rs.cf,
			en: rs.en,
			cn: rs.cn,
			examples: rs.examples,
			synonym: rs.synonym,
		}));

		if (limitedSenses.length > 0) {
			senses.push({
				pos,
				grammar: grammar || undefined,
				register: register || undefined,
				geo: geo || undefined,
				senses: limitedSenses,
				idioms: extractIdioms(sub),
			});
		}
	}

	// Strategy 2: If no subentry-g, try cixing_part sections
	if (senses.length === 0) {
		const parts = [...document.querySelectorAll('.cixing_part')];
		for (const part of parts) {
			const pos = textOf(part, 'pos');
			if (!pos) continue;

			const rawSenses = extractSensesFromSnGs(part);

			// Fallback: try direct def tags if no sn-gs
			// Only use <chn> that are direct children of <def> to avoid
			// picking up example-sentence translations from <x><chn>
			if (rawSenses.length === 0) {
				const defs = textAll(part, 'def');
				const chns = [...part.querySelectorAll('def')].map(defEl => {
					const directChn = [...defEl.children].find(c => c.tagName?.toLowerCase() === 'chn');
					return directChn?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
				});
				for (let i = 0; i < Math.min(defs.length, 6); i++) {
					rawSenses.push({ en: defs[i], cn: chns[i] || '', examples: [] });
				}
			}

			const limitedSenses = rawSenses.slice(0, 6).map(rs => ({
				number: rs.number,
				cf: rs.cf,
				en: rs.en,
				cn: rs.cn,
				examples: rs.examples,
				synonym: rs.synonym,
			}));

			if (limitedSenses.length > 0) {
				senses.push({
					pos,
					senses: limitedSenses,
					idioms: extractIdioms(part),
				});
			}
		}
	}

	// Strategy 3: If still nothing, try h-g structure (simple adjectives like "ephemeral")
	if (senses.length === 0) {
		const hGs = [...document.querySelectorAll('h-g')];
		for (const hG of hGs) {
			const pos = textOf(hG, 'pos');

			// Try structured sense extraction first (handles chn correctly)
			const rawSenses = extractSensesFromSnGs(hG);

			if (rawSenses.length > 0) {
				const limitedSenses = rawSenses.slice(0, 6).map(rs => ({
					number: rs.number,
					cf: rs.cf,
					en: rs.en,
					cn: rs.cn,
					examples: rs.examples,
					synonym: rs.synonym,
				}));

				senses.push({
					pos: pos || '',
					senses: limitedSenses,
					idioms: extractIdioms(hG),
				});
			} else {
				// Fallback: only use <chn> that are direct children of <def>
				const defs = textAll(hG, 'def');
				const chns = [...hG.querySelectorAll('def')].map(defEl => {
					const directChn = [...defEl.children].find(c => c.tagName?.toLowerCase() === 'chn');
					return directChn?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
				});

				if (defs.length > 0) {
					const limitedSenses = defs.slice(0, 6).map((en, i) => ({
						en,
						cn: chns[i] || '',
					}));

					senses.push({
						pos: pos || '',
						senses: limitedSenses,
					});
				}
			}
		}
	}

	// Attach entry-level phrasal verbs and derived forms to the first sense
	if (senses.length > 0) {
		const pvs = extractPhrasalVerbs(document as unknown as DocumentFragment);
		const dfs = extractDerivedForms(document as unknown as DocumentFragment);
		if (pvs) senses[0].phrasalVerbs = pvs;
		if (dfs) senses[0].derivedForms = dfs;

		// Also extract idioms at entry level (idm-gs container)
		const idmGsContainers = [...document.querySelectorAll('idm-gs')];
		for (const idmGs of idmGsContainers) {
			const entryIdioms = extractIdioms(idmGs);
			if (entryIdioms) {
				const target = senses.find(s => !s.idioms) || senses[0];
				target.idioms = [...(target.idioms || []), ...entryIdioms];
			}
		}
	}

	return senses;
}
