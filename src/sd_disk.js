// Virtuální disk pro emulovaný SD-ROM: strom adresářů a souborů v paměti.
// Odpovídá složce SDRoot v Java emulátoru (v prohlížeči se složka na disku namapovat nedá).
// Jména se hledají bez ohledu na velikost písmen (jako FAT), zobrazují se tak, jak byla zadána.

export const LOADER_NAME = '__BLOADER.BAS';

const dirNode = name => ({ name, dir: true, kids: new Map() });
const fileNode = (name, data) => ({ name, dir: false, data });

// Rozloží cestu na segmenty; '.' a '..' se vyřeší tak, že se nejde nad kořen (jako simplify() v Javě).
export function splitPath(path) {
  const out = [];
  for (const seg of String(path).split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out;
}

export class SdDisk {
  constructor({ loader = null } = {}) {
    this.root = dirNode('');
    this.onchange = null;
    if (loader) this.write(LOADER_NAME, loader);
  }

  _changed() { if (this.onchange) this.onchange(); }

  _find(path) {
    let node = this.root;
    for (const seg of splitPath(path)) {
      if (!node.dir) return null;
      node = node.kids.get(seg.toLowerCase());
      if (!node) return null;
    }
    return node;
  }

  exists(path) { return this._find(path) !== null; }

  // Obsah adresáře: adresáře a soubory zvlášť, abecedně. null = adresář neexistuje.
  list(path) {
    const node = this._find(path);
    if (!node || !node.dir) return null;
    const dirs = [], files = [];
    for (const k of node.kids.values()) (k.dir ? dirs : files).push(k.name);
    const cmp = (a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
    return { dirs: dirs.sort(cmp), files: files.sort(cmp) };
  }

  read(path) {
    const node = this._find(path);
    return node && !node.dir ? node.data : null;
  }

  write(path, data, { silent = false } = {}) {
    const segs = splitPath(path);
    if (!segs.length) throw new Error('Prázdná cesta');
    let node = this.root;
    for (const seg of segs.slice(0, -1)) {
      let next = node.kids.get(seg.toLowerCase());
      if (!next) { next = dirNode(seg); node.kids.set(seg.toLowerCase(), next); }
      if (!next.dir) throw new Error(`${seg} je soubor, ne adresář`);
      node = next;
    }
    const name = segs[segs.length - 1];
    node.kids.set(name.toLowerCase(), fileNode(name, data instanceof Uint8Array ? data : new Uint8Array(data)));
    if (!silent) this._changed();
  }

  remove(path) {
    const segs = splitPath(path);
    if (!segs.length) return false;
    const parent = this._find('/' + segs.slice(0, -1).join('/'));
    if (!parent || !parent.dir) return false;
    const ok = parent.kids.delete(segs[segs.length - 1].toLowerCase());
    if (ok) this._changed();
    return ok;
  }

  clear(keepLoader = true) {
    const loader = keepLoader ? this._find(LOADER_NAME) : null;
    this.root = dirNode('');
    if (loader) this.root.kids.set(loader.name.toLowerCase(), loader);
    this._changed();
  }

  // Přidá soubory z <input type=file> / drag&drop; u složek zachová relativní cestu.
  async addFiles(fileList) {
    let n = 0;
    for (const f of fileList) {
      const rel = f.webkitRelativePath || f._relPath || f.name;
      // u vybrané složky se vynechá její jméno (obsah složky patří do kořene disku)
      const path = f.webkitRelativePath ? rel.split('/').slice(1).join('/') : rel;
      this.write(path, new Uint8Array(await f.arrayBuffer()), { silent: true });
      n++;
    }
    this._changed();
    return n;
  }

  // Další číslo pro ukládaný soubor SAVE001, SAVE002 … (jako savnum v Javě).
  nextSaveNumber() {
    let max = 0;
    for (const k of this.root.kids.values()) {
      const m = /^save(\d{3})/i.exec(k.name);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  // Plochý seznam všech souborů (pro UI).
  allFiles() {
    const out = [];
    const walk = (node, prefix) => {
      for (const k of node.kids.values()) {
        if (k.dir) walk(k, prefix + k.name + '/');
        else out.push({ path: '/' + prefix + k.name, size: k.data.length });
      }
    };
    walk(this.root, '');
    return out.sort((a, b) => a.path.toLowerCase() < b.path.toLowerCase() ? -1 : 1);
  }
}
