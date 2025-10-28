export default function SeerNoiseFilter() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="0"
      height="0"
      aria-hidden="true"
    >
      <defs>
        <filter
          id="nnnoise-darken-fine"
          filterUnits="objectBoundingBox"
          primitiveUnits="objectBoundingBox"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="linearRGB"
        >
          {/* <!-- 1) Fine monochrome noise --> */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.69"
            numOctaves="1"
            seed="9"
            result="noise"
          />
          <feColorMatrix in="noise" type="saturate" values="0" result="g" />

          {/* <!-- 2) Shape the noise -> mostly near 0 with occasional spikes (speckles) --> */}
          {/* <!--    gamma < 1 = more speckles; > 1 = fewer --> */}
          <feComponentTransfer in="g" result="mask">
            <feFuncR type="gamma" amplitude="1" exponent="0.65" offset="0" />
            <feFuncG type="gamma" amplitude="1" exponent="0.65" offset="0" />
            <feFuncB type="gamma" amplitude="1" exponent="0.65" offset="0" />
          </feComponentTransfer>

          {/* <!-- 3) Keep noise only where the element is opaque (transparent areas stay clean) --> */}
          <feComposite
            in="mask"
            in2="SourceAlpha"
            operator="in"
            result="maskedNoise"
          />

          {/* <!-- 4) Darken-only: out = SourceGraphic * (1 - strength * maskedNoise) --> */}
          {/* <!--    arithmetic: k1=-strength, k2=1, k3=0, k4=0 --> */}
          <feComposite
            in="SourceGraphic"
            in2="maskedNoise"
            operator="arithmetic"
            k1="-1"
            k2="1"
            k3="0"
            k4="0"
          />
        </filter>
      </defs>
    </svg>
  );
}
