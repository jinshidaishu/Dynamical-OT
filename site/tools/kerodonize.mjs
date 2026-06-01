import fs from "node:fs";
import path from "node:path";

const publicDir = path.resolve(import.meta.dirname, "../public");
const sourceDir = path.resolve(import.meta.dirname, "../source");
const assetsDir = path.join(publicDir, "assets");
const siteCss = "assets/site-20260531.css";

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const read = (file) => fs.readFileSync(path.join(publicDir, file), "utf8");
const write = (file, text) => fs.writeFileSync(path.join(publicDir, file), text);

const tocSource = read("Notesli1.html");
const tocMatch = tocSource.match(/<div class='tableofcontents'>([\s\S]*?)<\/div>/);
if (!tocMatch) {
  throw new Error("Could not find TeX4ht table of contents.");
}

const navItems = [...tocMatch[1].matchAll(/<span class='([^']+)'>\s*([^<]*)\s*<a href='([^']+)'(?: id='[^']*')?>([\s\S]*?)<\/a><\/span>/g)]
  .map((match) => ({
    klass: match[1],
    number: match[2].trim(),
    href: match[3],
    title: match[4].replace(/\s+/g, " ").trim(),
  }));

if (fs.existsSync(path.join(publicDir, "Notesli2.html")) && !navItems.some((item) => item.href.startsWith("Notesli2.html"))) {
  navItems.push({
    klass: "likechapterToc",
    number: "Ref.",
    href: "Notesli2.html#bibliography",
    title: "Bibliography",
  });
}

const order = ["index.html", ...navItems.map((item) => item.href.split("#")[0])];
const uniqueOrder = [...new Set(order)];
const pageIndex = new Map(uniqueOrder.map((file, index) => [file, index]));

const stripGeneratedChrome = (body) =>
  body
    .replace(/<div class='crosslinks'>[\s\S]*?<\/div>/g, "")
    .replace(/<p class='indent'>\s*<a id='tail[^']*'><\/a>\s*<\/p>/g, "")
    .replace(/\n[ \t]*\n[ \t]*\n/g, "\n\n")
    .trim();

const bodyOf = (html) => {
  const match = html.match(/<body>([\s\S]*?)<\/body>/);
  return match ? match[1] : "";
};

const titleOf = (html, fallback) => {
  const match = html.match(/<title>([\s\S]*?)<\/title>/);
  return match?.[1]?.trim() || fallback;
};

const parseBracedFields = (value) => {
  const fields = [];
  for (let index = 0; index < value.length;) {
    if (value[index] !== "{") {
      index += 1;
      continue;
    }
    let depth = 0;
    const start = index + 1;
    for (; index < value.length; index += 1) {
      const char = value[index];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        fields.push(value.slice(start, index));
        index += 1;
        break;
      }
    }
  }
  return fields;
};

const stripOuterBraces = (value) => {
  let result = value;
  while (result.startsWith("{") && result.endsWith("}")) {
    const fields = parseBracedFields(result);
    if (fields.length !== 1 || fields[0].length !== result.length - 2) break;
    result = fields[0];
  }
  return result;
};

const auxPath = fs.existsSync(path.join(sourceDir, "Notes.labels.aux"))
  ? path.join(sourceDir, "Notes.labels.aux")
  : path.join(sourceDir, "Notes.aux");
const texPath = path.join(sourceDir, "Notes.tex");
const equationLabels = new Map();
if (fs.existsSync(auxPath)) {
  for (const line of fs.readFileSync(auxPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\\newlabel\{([^}]+)\}\{(.+)\}$/);
    if (!match) continue;
    const fields = parseBracedFields(stripOuterBraces(match[2]));
    const [number, , , kind] = fields;
    if (!number || !kind) continue;
    if (kind.startsWith("equation") || kind.startsWith("AMS")) {
      equationLabels.set(match[1], stripOuterBraces(number));
    }
  }
}

const refsByLine = new Map();
if (fs.existsSync(texPath)) {
  fs.readFileSync(texPath, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const labels = [...line.matchAll(/\\(?:eqref|reff|ref)\{([^}]+)\}/g)]
        .map((match) => match[1])
        .filter((label) => equationLabels.has(label));
      if (labels.length > 0) {
        refsByLine.set(index + 1, labels);
      }
    });
}

const unresolvedRefPattern = /<span class='cmbx-10x-x-109'>\?\?<\/span>/g;
const fixUnresolvedEquationRefs = (content) => {
  const markers = [...content.matchAll(/<!-- l\. (\d+) -->/g)];
  if (markers.length === 0 || equationLabels.size === 0) return content;

  let result = "";
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const start = marker.index;
    const end = index + 1 < markers.length ? markers[index + 1].index : content.length;
    if (index === 0) {
      result += content.slice(0, start);
    }

    const chunk = content.slice(start, end);
    const line = Number(marker[1]);
    const nextLine = index + 1 < markers.length ? Number(markers[index + 1][1]) : line + 1;
    const labels = [];
    for (let sourceLine = line; sourceLine < nextLine; sourceLine += 1) {
      labels.push(...(refsByLine.get(sourceLine) ?? []));
    }

    const alreadyResolved = new Set(
      [...chunk.matchAll(/tex4ht:ref:\s*([^-\s]+)\s*-->/g)].map((match) => match[1]),
    );
    const unresolvedLabels = labels.filter((label) => !alreadyResolved.has(label));
    let cursor = 0;

    result += chunk.replace(unresolvedRefPattern, (match) => {
      while (cursor < unresolvedLabels.length && !equationLabels.has(unresolvedLabels[cursor])) {
        cursor += 1;
      }
      const label = unresolvedLabels[cursor];
      cursor += 1;
      if (!label) return match;
      return `<span class='eqref-fixed' title='${escapeHtml(label)}'>${escapeHtml(equationLabels.get(label))}</span>`;
    });
  }
  return result;
};

const sidebar = `
<nav class="site-sidebar" aria-label="Contents">
  <a class="brand" href="index.html">
    <span class="brand-mark">OT</span>
    <span>
      <strong>Dynamical Optimal Transport</strong>
      <small>Yanxiang Zhao</small>
    </span>
  </a>
  <div class="sidebar-section">Forage</div>
  <div class="toc-list">
    ${navItems
      .map((item) => {
        const level = item.klass.includes("subsection")
          ? "subsection"
          : item.klass.includes("section")
            ? "section"
            : "chapter";
        return `<a class="toc-link toc-${level}" href="${item.href}" data-page="${item.href.split("#")[0]}"><span>${escapeHtml(item.number)}</span>${item.title}</a>`;
      })
      .join("\n    ")}
  </div>
</nav>`;

const header = `
<header class="site-header">
  <a class="mobile-brand" href="index.html">Dynamical OT</a>
  <button class="toc-toggle" type="button" aria-controls="site-sidebar" aria-expanded="false">Contents</button>
  <nav aria-label="Site links">
    <a href="index.html">home</a>
    <a href="Notesli1.html">structure</a>
    <a href="Notesap2.html">exercises</a>
  </nav>
</header>`;

const pageShell = ({ file, title, content, description = "" }) => {
  const index = pageIndex.get(file) ?? -1;
  const prev = index > 0 ? uniqueOrder[index - 1] : "";
  const next = index >= 0 && index < uniqueOrder.length - 1 ? uniqueOrder[index + 1] : "";
  const pageClass = file === "index.html" ? "home-page" : "content-page";
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Dynamical Optimal Transport</title>
  <meta name="description" content="${escapeHtml(description || "Lecture notes on dynamical optimal transport.")}">
  <link rel="stylesheet" href="Notes.css">
  <link rel="stylesheet" href="${siteCss}">
  <script>
    window.MathJax = {
      tex: {
        tags: "ams",
        macros: {
          al: "\\\\alpha",
          la: "\\\\lambda",
          va: "\\\\varphi",
          pa: "\\\\partial",
          tri: "\\\\triangle",
          Rnn: "\\\\mathbb{R}^{n\\\\times n}",
          Rnm: "\\\\mathbb{R}^{n\\\\times m}",
          Rmm: "\\\\mathbb{R}^{m\\\\times m}",
          Rn: "\\\\mathbb{R}^n",
          Rm: "\\\\mathbb{R}^m",
          Urange: "\\\\langle \\\\hat{U} \\\\rangle",
          Vrange: "\\\\langle \\\\hat{V} \\\\rangle",
          Qrange: "\\\\langle \\\\hat{Q} \\\\rangle",
          Uhat: "\\\\hat{U}",
          Vhat: "\\\\hat{V}",
          Qhat: "\\\\hat{Q}",
          Utilde: "\\\\tilde{U}",
          Vtilde: "\\\\tilde{V}",
          Qtilde: "\\\\tilde{Q}",
          RR: "\\\\mathbb{R}",
          R: "\\\\mathbb{R}",
          NN: "\\\\mathbb{N}",
          PP: "\\\\mathcal{P}",
          bbZ: "\\\\mathbb{Z}",
          bbR: "\\\\mathbb{R}",
          bbC: "\\\\mathbb{C}",
          calE: "\\\\mathcal{E}",
          calK: "\\\\mathcal{K}",
          calC: "\\\\mathcal{C}",
          Z: "\\\\mathbb{Z}",
          bx: "\\\\mathbf{x}",
          bX: "\\\\mathbf{X}",
          by: "\\\\mathbf{y}",
          bz: "\\\\mathbf{z}",
          bfm: "\\\\mathbf{m}",
          bn: "\\\\mathbf{n}",
          br: "\\\\mathbf{r}",
          bv: "\\\\mathbf{v}",
          bu: "\\\\mathbf{u}",
          bT: "\\\\mathbf{T}",
          ve: "\\\\varepsilon",
          phinone: "\\\\phi^{n+1}",
          phin: "\\\\phi^{n}",
          eps: "\\\\epsilon",
          F: "\\\\mathcal{F}",
          E: "\\\\mathcal{E}",
          G: "\\\\mathcal{G}",
          lm: "\\\\displaystyle\\\\liminf",
          TTT: "\\\\mathbb{T}^3",
          p: "\\\\partial",
          ud: "\\\\mathrm{d}",
          tr: "\\\\operatorname{tr}",
          I: "\\\\mathrm{I}",
          TT: "\\\\mathbb{T}^2",
          Ptwo: "\\\\mathcal{P}_2(\\\\mathbb{R}^n)",
          W: "W_2",
          dx: "\\\\mathrm{d}\\\\mathbf{x}",
          dt: "\\\\mathrm{d}t",
          dd: "\\\\mathrm{d}",
          KL: "\\\\operatorname{KL}",
          argmin: "\\\\operatorname{argmin}",
          argmax: "\\\\operatorname{argmax}",
          prox: "\\\\operatorname{prox}",
          diag: "\\\\operatorname{diag}",
          grad: "\\\\operatorname{grad}",
          div: "\\\\operatorname{div}",
          divergence: "\\\\operatorname{div}",
          id: "\\\\mathrm{Id}",
          gradw: "\\\\nabla_{\\\\!W}",
          defeq: "\\\\stackrel{\\\\scriptscriptstyle \\\\text{def}}=",
          deldrho: ["\\\\frac{\\\\delta #1}{\\\\delta\\\\rho}", 1],
          upmu: "\\\\mu",
          upnu: "\\\\nu"
        }
      }
    };
  </script>
  <script defer src="assets/site-20260530.js"></script>
  <script async id="MathJax-script" src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml-full.js"></script>
</head>
<body class="${pageClass}" data-page="${file}">
  ${header}
  <div class="site-frame">
    ${sidebar}
    <main class="site-main">
      ${content}
      <nav class="page-nav" aria-label="Page navigation">
        ${prev ? `<a class="prev-link" href="${prev}">Previous</a>` : "<span></span>"}
        ${next ? `<a class="next-link" href="${next}">Next</a>` : "<span></span>"}
      </nav>
    </main>
  </div>
</body>
</html>`;
};

const grouped = [];
for (const item of navItems) {
  if (item.klass.includes("chapter") || item.klass.includes("appendix")) {
    grouped.push({ ...item, sections: [] });
  } else if (grouped.length) {
    grouped[grouped.length - 1].sections.push(item);
  }
}

const homeContent = `
<section class="home-hero">
  <div>
    <p class="eyebrow">Lecture notes</p>
    <h1><span>Dynamical Optimal Transport</span><small>by Yanxiang Zhao</small></h1>
    <p class="lede">A free online resource for theory, methods, and algorithms of dynamical optimal transport.</p>
  </div>
  <figure>
    <img src="assets/dynamical-ot-manifold-hero.png" alt="Dynamical optimal transport flow between two densities on a manifold">
  </figure>
</section>
<section class="home-structure" aria-labelledby="forage-heading">
  <h2 id="forage-heading">Forage</h2>
  ${grouped
    .map(
      (chapter) => `<section class="chapter-entry">
    <h3><a href="${chapter.href}">${escapeHtml(chapter.number)} ${chapter.title}</a></h3>
    <div class="chapter-links">
      ${chapter.sections
        .map((section) => `<a href="${section.href}">${escapeHtml(section.number)} ${section.title}</a>`)
        .join("\n      ")}
    </div>
  </section>`,
    )
    .join("\n  ")}
</section>`;

write("index.html", pageShell({
  file: "index.html",
  title: "Dynamical Optimal Transport",
  description: "A Kerodon-inspired web edition of Yanxiang Zhao's lecture notes on optimal transport.",
  content: homeContent,
}));

for (const file of fs.readdirSync(publicDir).filter((name) => name.endsWith(".html") && name !== "index.html")) {
  const original = read(file);
  const title = titleOf(original, "Lecture Notes");
  const content = fixUnresolvedEquationRefs(stripGeneratedChrome(bodyOf(original)));
  write(file, pageShell({ file, title, content }));
}

fs.writeFileSync(
  path.join(assetsDir, "manifest.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), pages: uniqueOrder.length }, null, 2)}\n`,
);
