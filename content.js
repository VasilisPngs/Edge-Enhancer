(() => {
    const id = "edge-enhancer-sharpen";
    const ns = "http://www.w3.org/2000/svg";

    if (document.getElementById(id)) return;

    const svg = document.createElementNS(ns, "svg");
    const filter = document.createElementNS(ns, "filter");
    const blur = document.createElementNS(ns, "feGaussianBlur");
    const composite = document.createElementNS(ns, "feComposite");

    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";

    filter.id = id;
    filter.setAttribute("color-interpolation-filters", "sRGB");

    blur.setAttribute("stdDeviation", "0.7");
    blur.setAttribute("result", "blur");

    composite.setAttribute("in", "SourceGraphic");
    composite.setAttribute("in2", "blur");
    composite.setAttribute("operator", "arithmetic");
    composite.setAttribute("k2", "1.5");
    composite.setAttribute("k3", "-0.5");

    filter.append(blur, composite);
    svg.append(filter);
    document.documentElement.append(svg);
})();
