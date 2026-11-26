import { describe, expect, it } from "vitest";
import { isAnswersHeading, parseBlocks, parseChart, parseInline } from "../web/src/markdown-parse.ts";

describe("the Markdown in an answer", () => {
  it("reads the blocks a tutor writes", () => {
    const md = [
      "La **idea**: un proceso es un programa corriendo.",
      "",
      "### Cómo funciona",
      "- Primero",
      "  - un detalle",
      "- Segundo",
      "  sigue acá",
      "",
      "1. Uno",
      "2. Dos",
      "",
      "| Término | Qué es |",
      "|---|:-:|",
      "| PID | número del proceso |",
      "",
      "```bash",
      "ps aux | grep x",
      "```",
      "",
      "> **Para recordar:** el SO reparte la CPU.",
    ].join("\n");
    const b = parseBlocks(md);
    expect(b.map((x) => x.t)).toEqual(["p", "h", "list", "list", "table", "code", "quote"]);
    const bullets = b[2] as Extract<typeof b[number], { t: "list" }>;
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    expect(bullets.items[0]!.children[0]).toMatchObject({ t: "list", items: [{ text: "un detalle" }] });
    expect(bullets.items[1]!.text).toBe("Segundo\nsigue acá");
    expect(b[3]).toMatchObject({ t: "list", ordered: true, start: 1 });
    expect(b[4]).toMatchObject({ t: "table", head: ["Término", "Qué es"], align: [null, "center"], rows: [["PID", "número del proceso"]] });
    expect(b[5]).toEqual({ t: "code", lang: "bash", text: "ps aux | grep x" });
    expect(b[6]).toMatchObject({ t: "quote", blocks: [{ t: "p" }] });
  });

  it("keeps math, and leaves dollars that are not math alone", () => {
    expect(parseBlocks("$$\nE = mc^2\n$$")).toEqual([{ t: "math", text: "E = mc^2" }]);
    expect(parseBlocks("\\[ a^2 + b^2 \\]")).toEqual([{ t: "math", text: "a^2 + b^2" }]);
    expect(parseInline("si $x^2$ crece")).toEqual([{ t: "text", v: "si " }, { t: "math", v: "x^2" }, { t: "text", v: " crece" }]);
    expect(parseInline("cuesta $5 o $10")).toEqual([{ t: "text", v: "cuesta $5 o $10" }]);
    expect(parseInline("usá $HOME y $PATH")).toEqual([{ t: "text", v: "usá $HOME y $PATH" }]);
    expect(parseInline("y \\(n \\log n\\)")).toEqual([{ t: "text", v: "y " }, { t: "math", v: "n \\log n" }]);
  });

  it("turns marks into structure and links into plain words", () => {
    expect(parseInline("**fuerte** y *suave* y `ls -l`")).toEqual([
      { t: "strong", c: [{ t: "text", v: "fuerte" }] }, { t: "text", v: " y " },
      { t: "em", c: [{ t: "text", v: "suave" }] }, { t: "text", v: " y " }, { t: "code", v: "ls -l" },
    ]);
    expect(parseInline("[la doc](javascript:alert(1))")).toEqual([{ t: "link", c: [{ t: "text", v: "la doc" }] }, { t: "text", v: ")" }]);
    expect(parseInline("snake_case_name")).toEqual([{ t: "text", v: "snake_case_name" }]);
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
  });

  it("knows where a quiz keeps its answers", () => {
    expect(isAnswersHeading("Respuestas")).toBe(true);
    expect(isAnswersHeading("**Soluciones**")).toBe(true);
    expect(isAnswersHeading("Preguntas")).toBe(false);
  });

  it("checks a chart before drawing it", () => {
    expect(parseChart('{"type":"bar","labels":["a","b"],"series":[{"name":"n","data":[1,2]}]}'))
      .toEqual({ type: "bar", title: "", labels: ["a", "b"], series: [{ name: "n", data: [1, 2] }], x: "", y: "" });
    expect(parseChart('{"type":"line","series":[{"data":[3,4,5]}]}')?.labels).toEqual(["1", "2", "3"]);
    expect(parseChart("not json")).toBeNull();
    expect(parseChart('{"type":"radar","series":[{"data":[1]}]}')).toBeNull();
    expect(parseChart('{"type":"bar","series":[{"data":["x"]}]}')).toBeNull();
    expect(parseChart('{"type":"pie","labels":["a"],"series":[{"data":[0]}]}')).toBeNull();
  });
});
