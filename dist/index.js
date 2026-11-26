//#region src/model.ts
var e = [
	{
		id: "linearLight",
		label: "Linear Light"
	},
	{
		id: "overlay",
		label: "Overlay"
	},
	{
		id: "softLight",
		label: "Soft Light"
	},
	{
		id: "hardLight",
		label: "Hard Light"
	}
], t = Object.fromEntries(e.map((e, t) => [e.id, t])), n = {
	amount: 0,
	radius: .5,
	mode: t.linearLight,
	monochrome: !1
}, r = {
	amount: {
		min: 0,
		max: 100,
		step: 1
	},
	radius: {
		min: .1,
		max: 5,
		step: .05
	},
	mode: {
		min: 0,
		max: e.length - 1,
		step: 1
	}
}, i = [
	.2126,
	.7152,
	.0722
], a = (e) => +(e.amount > 0), o = "high-pass-sharpen", s = `${o}.layer`, c = [
	"amount",
	"radius",
	"mode",
	"monochrome"
], l = "draws", u = (e) => `${s}.${e}`, d = (e, t) => Math.min(Math.max(e, r[t].min), r[t].max);
function f(e) {
	let t = { ...n };
	for (let n of [
		"amount",
		"radius",
		"mode"
	]) {
		let r = e[u(n)];
		typeof r == "number" && Number.isFinite(r) && (t[n] = d(n === "mode" ? Math.round(r) : r, n));
	}
	let r = e[u("monochrome")];
	return typeof r == "boolean" && (t.monochrome = r), t;
}
function p(e) {
	let t = {};
	for (let n of c) t[u(n)] = e[n];
	return t[u(l)] = a(e), t;
}
function m(e) {
	if (!c.some((t) => u(t) in e) && !(u("draws") in e)) return null;
	let t = a(f(e));
	return e[u("draws")] === t ? null : { [u(l)]: t };
}
var h = () => p(n), g, _;
function v(e) {
	_ = e, g = e.react;
}
var y = "\n\nfloat hpUlp(float v) {\n  highp int e = ((floatBitsToInt(v) >> 23) & 255) - 127;\n  return intBitsToFloat((max(e - 10, -24) + 127) << 23);\n}\nfloat hpHalfRound(float v) {\n  float x = clamp(v, -65504.0, 65504.0);\n  float q = hpUlp(x);\n  return roundEven(x / q) * q;\n}\nvec4 hpHalf4(vec4 v) { return vec4(hpHalfRound(v.x), hpHalfRound(v.y), hpHalfRound(v.z), hpHalfRound(v.w)); }\n\nfloat hpSigma(float r, vec2 texel, vec2 sourceSize) {\n  float source = max(sourceSize.x, sourceSize.y);\n  float render = max(1.0 / texel.x, 1.0 / texel.y);\n  return source > 0.0 ? r * render / source : r;\n}\nint hpReach(float sigma) { return clamp(int(ceil(3.0 * sigma + 0.5)), 1, 16); }\nfloat hpErf(float x) {\n  float a = abs(x);\n  float t = 1.0 / (1.0 + 0.3275911 * a);\n  float poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));\n  return sign(x) * (1.0 - poly * exp(-a * a));\n}\nfloat hpTap(int n, float scale) {\n  return 0.5 * (hpErf((float(n) + 0.5) * scale) - hpErf((float(n) - 0.5) * scale));\n}\n", b = "\nivec2 q = ivec2(gl_FragCoord.xy);\nfloat sigma = hpSigma(radius, uTexel, uSourceSize);\nint reach = hpReach(sigma);\nfloat scale = 1.0 / (max(sigma, 0.001) * 1.4142135624);\nfloat weight = hpErf(0.5 * scale);", x = `${b}
vec3 total = weight * fetchInput(q);
for (int n = 1; n <= 16; n++) {
  if (n > reach) break;
  float w = hpTap(n, scale);
  total += w * (fetchInput(q - ivec2(n, 0)) + fetchInput(q + ivec2(n, 0)));
  weight += 2.0 * w;
}
c = hpHalf4(vec4(total / weight, 1.0));
`, S = `${b}
int last = int(floor(1.0 / uTexel.y + 0.5)) - 1;
vec3 total = weight * fetchPrev4(q).rgb;
for (int n = 1; n <= 16; n++) {
  if (n > reach) break;
  float w = hpTap(n, scale);
  total += w * (fetchPrev4(ivec2(q.x, max(q.y - n, 0))).rgb + fetchPrev4(ivec2(q.x, min(q.y + n, last))).rgb);
  weight += 2.0 * w;
}
vec3 layer = fetchInput(q) - total / weight;
if (monochrome) layer = vec3(dot(layer, vec3(${i.join(", ")})));
c = hpHalf4(vec4(layer, 1.0));
`, C = [{
	name: "blur x",
	glsl: x,
	keys: ["radius"]
}, {
	name: "blur y, high pass",
	glsl: S,
	keys: ["radius", "monochrome"]
}], w = `
float hpHard(float cb, float cs) {
  return cs <= 0.5 ? cb * 2.0 * cs : cb + (2.0 * cs - 1.0) - cb * (2.0 * cs - 1.0);
}
float hpSoft(float cb, float cs) {
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(max(cb, 0.0));
  return cs <= 0.5 ? cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb) : cb + (2.0 * cs - 1.0) * (d - cb);
}
float hpBlendOne(int m, float cb, float cs) {
  if (m == ${t.overlay}) return hpHard(cs, cb);
  if (m == ${t.softLight}) return hpSoft(cb, cs);
  if (m == ${t.hardLight}) return hpHard(cb, cs);
  return cb + 2.0 * cs - 1.0;
}
vec3 hpBlend(int m, vec3 cb, vec3 cs) {
  return vec3(hpBlendOne(m, cb.x, cs.x), hpBlendOne(m, cb.y, cs.y), hpBlendOne(m, cb.z, cs.z));
}
`, T = "\nif (draws > 0) {\n  vec3 blended = hpBlend(mode, c, 0.5 + stageResult);\n  blended = clamp(blended, min(c, vec3(0.0)), max(c, vec3(1.0)));\n  c = mix(c, blended, amount / 100.0);\n}\n", E = {
	amount: "Amount",
	radius: "Radius",
	mode: "Blend mode",
	monochrome: "Monochrome"
};
function D(e) {
	if (e === "monochrome") return {
		key: e,
		glslType: "bool",
		default: n.monochrome,
		label: E.monochrome
	};
	let t = e;
	return {
		key: e,
		glslType: t === "mode" ? "int" : "float",
		default: n[t],
		range: r[t],
		label: E[t]
	};
}
var O = {
	key: l,
	glslType: "int",
	default: 0
};
function k() {
	return {
		id: s,
		name: "High Pass Sharpen",
		phase: "display-adjust",
		priority: 150,
		reads: "current",
		space: {
			encoding: "perceptual",
			primaries: "rec709"
		},
		glsl: T,
		helpers: w,
		uniforms: [O, ...c.map(D)],
		passes: C.map((e) => ({
			channels: 4,
			glsl: e.glsl,
			helpers: y,
			iterations: {
				key: l,
				max: 1
			},
			uniforms: e.keys.map(D)
		})),
		dormantWhen: { [l]: 0 },
		mask: { maskable: !0 }
	};
}
//#endregion
//#region src/Panel.tsx
var A = ["amount", "radius"], j = "High Pass Sharpen", M = (e) => `${j}: ${E[e]}`, N = e.map((e, t) => ({
	value: String(t),
	label: e.label
}));
function P() {
	let { Slider: e } = _.components, { Field: t, Select: i, Stack: o, Toggle: s } = _.ui, c = _.develop.useParamScope(), d = f(c.getParams());
	return /* @__PURE__ */ g.createElement(o, {
		gap: 6,
		style: { padding: 8 }
	}, A.map((t) => /* @__PURE__ */ g.createElement(e, {
		key: t,
		label: E[t],
		value: d[t],
		min: r[t].min,
		max: r[t].max,
		step: r[t].step,
		defaultValue: n[t],
		onChange: (e) => {
			let n = {
				...f(c.getParams()),
				[t]: e
			};
			c.setParams({
				[u(t)]: e,
				[u(l)]: a(n)
			});
		},
		onCommit: () => c.commit(M(t))
	})), /* @__PURE__ */ g.createElement(t, { label: E.mode }, /* @__PURE__ */ g.createElement(i, {
		ariaLabel: E.mode,
		value: String(d.mode),
		options: N,
		onChange: (e) => {
			c.setParams({ [u("mode")]: Number(e) }), c.commit(M("mode"));
		}
	})), /* @__PURE__ */ g.createElement(s, {
		label: E.monochrome,
		checked: d.monochrome,
		onChange: (e) => {
			c.setParams({ [u("monochrome")]: e }), c.commit(M("monochrome"));
		}
	}));
}
//#endregion
//#region src/index.tsx
var F = `${o}.panel`, I = null;
function L() {
	let e = _.stores.useDevelopStore.getState();
	e.setDynParams(h()), e.commitEdit("High Pass Sharpen reset");
}
function R(e) {
	v(e), e.registerProcessingStage(k()), e.registerPanel({
		id: F,
		title: "High Pass Sharpen",
		component: P,
		defaultDock: {
			module: "develop",
			direction: "right",
			width: 280
		},
		modules: ["develop"],
		onReset: L,
		mask: {
			component: P,
			owns: [...c, l].map(u)
		}
	}), I?.(), I = e.stores.useDevelopStore.subscribe((e, t) => {
		if (e.params.masks !== t.params.masks) for (let n of e.params.masks) {
			if (t.params.masks.some((e) => e.id === n.id && e.bag === n.bag)) continue;
			let r = n.bag ? m(n.bag) : null;
			r && e.updateMaskBag(n.id, r);
		}
		if (e.paramBag === t.paramBag) return;
		let n = m(e.paramBag);
		n && e.setDynParams(n);
	});
}
function z() {
	I?.(), I = null;
}
//#endregion
export { F as PANEL_ID, R as activate, z as deactivate };

//# sourceMappingURL=index.js.map