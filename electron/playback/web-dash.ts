import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom';
import { httpMediaUrl } from '../providers/url-media';

type Register = (url: string) => string;
const children = (node: XmlElement, name: string) => Array.from(node.childNodes)
  .filter((child): child is XmlElement => child.nodeType === 1 && child.localName === name);

function ancestors(node: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  let current: XmlElement | null = node;
  while (current) {
    result.unshift(current);
    current = current.parentNode?.nodeType === 1 ? current.parentNode as XmlElement : null;
  }
  return result;
}

function effectiveBase(node: XmlElement, address: string): string {
  let base = address;
  for (const ancestor of ancestors(node)) {
    const value = children(ancestor, 'BaseURL')[0]?.textContent?.trim();
    if (value) base = httpMediaUrl(value, base);
  }
  return base;
}

function mergeSegment(node: XmlElement, name: string): XmlElement {
  const levels = ancestors(node).flatMap(ancestor => children(ancestor, name).slice(0, 1));
  const merged = levels[0].cloneNode(false) as XmlElement;
  for (const level of levels) {
    for (const attribute of Array.from(level.attributes)) merged.setAttribute(attribute.name, attribute.value);
    for (const child of Array.from(level.childNodes)) {
      if (child.nodeType !== 1) continue;
      const element = child as XmlElement;
      // SegmentURL is a list replaced by the closest list; other children override by name.
      if (element.localName === 'SegmentURL') continue;
      for (const previous of children(merged, element.localName || '')) merged.removeChild(previous);
      merged.appendChild(element.cloneNode(true));
    }
    const urls = children(level, 'SegmentURL');
    if (urls.length) {
      for (const previous of children(merged, 'SegmentURL')) merged.removeChild(previous);
      for (const url of urls) merged.appendChild(url.cloneNode(true));
    }
  }
  return merged;
}

/** Flatten inherited addressing and keep every track; reject protected/ambiguous MPDs. */
export function rewriteWebDash(text: string, address: string, register: Register, template: Register): string {
  if (text.length > 4000000 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('无效的 DASH 清单');
  const document = new DOMParser({ onError: () => { throw new Error('无效的 DASH 清单'); } })
    .parseFromString(text, 'application/xml');
  const root = document.documentElement;
  if (!root || root.localName !== 'MPD') throw new Error('无效的 DASH 清单');
  const all = Array.from(document.getElementsByTagName('*'));
  if (all.length > 20000 || all.some(node => node.localName === 'ContentProtection'
    || node.hasAttributeNS('http://www.w3.org/1999/xlink', 'href'))) {
    throw new Error('此网页视频包含受保护或不支持的媒体结构');
  }
  const representations = all.filter(node => node.localName === 'Representation');
  if (!representations.length || representations.length > 500) throw new Error('DASH 清单没有可用视频轨');
  for (const representation of representations) {
    const base = effectiveBase(representation, address);
    const segment = ancestors(representation).reverse().flatMap(ancestor =>
      Array.from(ancestor.childNodes).filter((child): child is XmlElement => child.nodeType === 1
        && ['SegmentTemplate', 'SegmentList', 'SegmentBase'].includes(child.localName || '')))[0];
    if (!segment) throw new Error('不支持此 DASH 分段结构');
    const clone = mergeSegment(representation, segment.localName!);
    if (segment.parentNode === representation) representation.removeChild(segment);
    representation.appendChild(clone);
    const bind = (value: string) => httpMediaUrl(value
      .replace(/\$RepresentationID\$/g, encodeURIComponent(representation.getAttribute('id') || ''))
      .replace(/\$Bandwidth\$/g, representation.getAttribute('bandwidth') || ''), base);
    if (clone.localName === 'SegmentTemplate') {
      if (!clone.getAttribute('media')) throw new Error('DASH 清单缺少分段地址');
      for (const name of ['media', 'initialization', 'index']) {
        const value = clone.getAttribute(name);
        if (value) {
          const url = bind(value);
          clone.setAttribute(name, url.includes('$') ? template(url) : register(url));
        }
      }
    } else if (clone.localName === 'SegmentList') {
      for (const node of [clone, ...Array.from(clone.getElementsByTagName('*'))]) {
        for (const name of ['media', 'index', 'sourceURL']) {
          const value = node.getAttribute(name);
          if (value) node.setAttribute(name, register(bind(value)));
        }
      }
    } else {
      const element = document.createElementNS(root.namespaceURI, 'BaseURL');
      element.appendChild(document.createTextNode(register(base)));
      representation.appendChild(element);
      for (const node of Array.from(clone.getElementsByTagName('*'))) {
        const value = node.getAttribute('sourceURL');
        if (value) node.setAttribute('sourceURL', register(bind(value)));
      }
    }
  }
  for (const node of all) {
    if (node.localName === 'BaseURL' || ['SegmentTemplate', 'SegmentList', 'SegmentBase'].includes(node.localName || '')
      && node.parentNode?.nodeType === 1 && (node.parentNode as XmlElement).localName !== 'Representation') {
      node.parentNode?.removeChild(node);
    }
    const location = node.textContent;
    if (node.localName === 'Location' && location) node.textContent = register(httpMediaUrl(location.trim(), address));
  }
  return new XMLSerializer().serializeToString(document);
}
