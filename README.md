# High Pass Sharpen for Safelight

A [Safelight](https://github.com/anthonyreimche/SafeLight) extension that
sharpens the way a photo editor's High Pass layer does. You'd usually do it
by hand: duplicate the layer, run High Pass on the copy with a small radius,
set the copy's blend mode to Linear Light and lower its opacity to taste.
This extension does those steps in the Develop pipeline, so you don't have to
export the photo and finish it in another program, and you can still change
the settings later.

With a radius of half a pixel or less, it brings out very fine detail.
Unsharp Mask and deconvolution tend to work on coarser structure.

## The controls

- **Amount** (0 to 100, default 0): the layer's opacity. At 0 the stage is
  dormant and costs nothing.
- **Radius** (0.1 to 5 px, default 0.5): the standard deviation of the
  Gaussian that High Pass subtracts, in the full-size photo's pixels. Use 0.5
  or less for fine detail. Larger radii work more like local contrast and
  start to leave halos.
- **Blend mode** (default Linear Light): how the layer is blended over the
  photo.
  - **Linear Light** adds twice the layer's distance from grey: the photo plus
    twice its own fine detail. It's the strongest mode.
  - **Hard Light** and **Overlay** give the same result in the midtones,
    tapering toward black and white.
  - **Soft Light** is the gentlest.
- **Monochrome**: makes the layer grey (its luminance), so sharpening changes
  lightness only and adds no colour fringes. This matches the High Pass
  filter's Monochrome option.

**In masks:** to sharpen only inside a mask, add High Pass Sharpen to it from
the Masking panel's Adjust tab.

## The math

- **The layer** is the photo minus its Gaussian blur, plus 0.5. It works on
  display-encoded RGB, as an 8- or 16-bit RGB document holds it. Edges repeat
  outward.
- **The blend modes** use the W3C Compositing and Blending formulas, which
  match the photo editors'.
- **Clipping:** the blended result is clipped to 0 to 1, as a document clips
  it, and then mixed in by the amount. A value already above 1 or below 0 is
  never pushed further out, so headroom is kept and never clipped.

### Where it sits

The stage is in the display phase, after the tone curve and the other
sharpening tools (Sharpen Edges, Sharpen Microcontrast, USM and RL
Sharpening). It reads the photo as edited up to that point, as the duplicated
layer would.

### How it maps onto Safelight

The layer is built by two draws of a separable blur, one along x and one along
y. The second draw also takes the difference. The stage's inline code then
blends the layer over the pixel.

- **Radius scaling:** the radius is in the full-size photo's pixels. Develop's
  preview and thumbnails render below that size, so the radius is scaled down
  to the render, and a preview blurs the same part of the scene that an export
  does. Judge the effect at 100% zoom.
- **Below one pixel:** each tap is weighted by the Gaussian's mass over that
  pixel's area, not by its value at the pixel's centre. A Gaussian sampled at
  pixel centres puts almost nothing on the neighbours below a radius of about
  0.4, so a radius of 0.3 would do nearly nothing. Weighted by area, it still
  blurs a little. Photo editors don't document how their own High Pass handles
  sub-pixel radii. Treat the radius as a dial to tune by eye, not a number to
  copy from another program.
- **Cost:** a draw reads at most 34 texels, at the largest radius.
- **Precision:** the draws store half floats and round each value to the
  nearest one themselves, so every GPU gives the same layer. The layer lands
  within about 2e-4 of the CPU model in `src/model.ts`.

## Development

```
npm run check       # typecheck, build, unit tests
npm run test:gpu    # the shaders against the CPU model, in a SafeLight checkout
npm run update-types
```
