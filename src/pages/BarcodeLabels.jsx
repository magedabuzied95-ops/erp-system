export default function BarcodeLabels() {

  const products = [

    {
      id: "AD-ULTRA-001",

      brand: "ADIDAS",

      name: "Ultraboost 23",

      size: "42",

      color: "Black / White",

      price: "5999 EGP",

      image:
        "https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=1200&auto=format&fit=crop",

      barcode:
        "890123456789",
    },

    {
      id: "NK-AIR-002",

      brand: "NIKE",

      name: "Air Max Pro",

      size: "43",

      color: "White / Red",

      price: "6499 EGP",

      image:
        "https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?q=80&w=1200&auto=format&fit=crop",

      barcode:
        "890123456790",
    },
  ];

  return (

    <div
      className="
      min-h-screen
      bg-gradient-to-br
      from-gray-100
      via-white
      to-gray-200
      p-10
      "
    >

      <div className="max-w-7xl mx-auto">

        {/* HEADER */}

        <div
          className="
          flex
          items-center
          justify-between
          flex-wrap
          gap-6
          mb-10
          "
        >

          <div>

            <h1
              className="
              text-6xl
              font-black
              text-gray-900
              "
            >
              Barcode Label Studio 🔥
            </h1>

            <p
              className="
              text-gray-500
              mt-4
              text-xl
              "
            >
              Enterprise barcode labels for shoes & fashion products
            </p>

          </div>

          <button

            onClick={() =>
              window.print()
            }

            className="
            bg-black
            hover:bg-gray-800
            text-white
            px-8
            py-5
            rounded-3xl
            font-black
            text-lg
            shadow-2xl
            transition-all
            duration-300
            hover:scale-105
            "
          >
            Print Labels 🖨️
          </button>

        </div>

        {/* LABELS */}

        <div
          className="
          grid
          grid-cols-1
          md:grid-cols-2
          xl:grid-cols-3
          gap-8
          "
        >

          {products.map((product) => (

            <div

              key={product.id}

              className="
              bg-white
              rounded-[36px]
              overflow-hidden
              shadow-2xl
              border
              border-gray-200
              hover:-translate-y-2
              hover:shadow-[0_20px_60px_rgba(0,0,0,0.2)]
              transition-all
              duration-500
              "
            >

              {/* IMAGE */}

              <div
                className="
                relative
                h-80
                overflow-hidden
                "
              >

                <img

                  src={product.image}

                  alt={product.name}

                  className="
                  w-full
                  h-full
                  object-cover
                  hover:scale-110
                  transition-all
                  duration-700
                  "
                />

                {/* BRAND */}

                <div
                  className="
                  absolute
                  top-5
                  left-5
                  bg-black/80
                  backdrop-blur-lg
                  text-white
                  px-5
                  py-3
                  rounded-full
                  text-sm
                  font-black
                  tracking-[4px]
                  shadow-xl
                  "
                >
                  {product.brand}
                </div>

                {/* PRICE */}

                <div
                  className="
                  absolute
                  bottom-5
                  right-5
                  bg-white
                  text-black
                  px-5
                  py-3
                  rounded-full
                  font-black
                  shadow-2xl
                  text-lg
                  "
                >
                  {product.price}
                </div>

              </div>

              {/* CONTENT */}

              <div className="p-7">

                {/* TITLE */}

                <div
                  className="
                  flex
                  items-start
                  justify-between
                  gap-5
                  "
                >

                  <div>

                    <h2
                      className="
                      text-3xl
                      font-black
                      text-gray-900
                      "
                    >
                      {product.name}
                    </h2>

                    <p
                      className="
                      text-gray-500
                      mt-3
                      text-lg
                      "
                    >
                      {product.color}
                    </p>

                  </div>

                  {/* SIZE */}

                  <div
                    className="
                    bg-gray-100
                    px-5
                    py-3
                    rounded-3xl
                    font-black
                    text-2xl
                    shadow-inner
                    "
                  >
                    {product.size}
                  </div>

                </div>

                {/* SKU */}

                <div
                  className="
                  mt-7
                  border
                  border-dashed
                  border-gray-300
                  rounded-[30px]
                  p-6
                  bg-gradient-to-br
                  from-gray-50
                  to-white
                  "
                >

                  <div
                    className="
                    flex
                    items-center
                    justify-between
                    mb-5
                    "
                  >

                    <div>

                      <p
                        className="
                        text-xs
                        uppercase
                        tracking-[5px]
                        text-gray-400
                        font-black
                        "
                      >
                        SKU
                      </p>

                      <h3
                        className="
                        font-black
                        text-xl
                        mt-2
                        "
                      >
                        {product.id}
                      </h3>

                    </div>

                    <div
                      className="
                      w-16
                      h-16
                      rounded-3xl
                      bg-black
                      text-white
                      flex
                      items-center
                      justify-center
                      font-black
                      text-2xl
                      shadow-xl
                      "
                    >
                      {
                        product.brand[0]
                      }
                    </div>

                  </div>

                  {/* BARCODE */}

                  <div
                    className="
                    bg-white
                    rounded-3xl
                    p-5
                    border
                    border-gray-200
                    overflow-hidden
                    shadow-inner
                    "
                  >

                    <div
                      className="
                      flex
                      items-end
                      gap-[2px]
                      h-28
                      justify-center
                      "
                    >

                      {product.barcode
                        .split("")
                        .map((
                          digit,
                          index
                        ) => (

                          <div

                            key={index}

                            className={`

                            bg-black
                            rounded-sm

                            ${
                              index % 2 === 0

                              ? "w-[3px] h-full"

                              : "w-[2px] h-[85%]"
                            }

                            `}
                          />
                        ))}

                    </div>

                    <div
                      className="
                      text-center
                      mt-4
                      tracking-[8px]
                      font-mono
                      text-sm
                      font-black
                      "
                    >
                      {product.barcode}
                    </div>

                  </div>

                </div>

                {/* INFO */}

                <div
                  className="
                  mt-7
                  grid
                  grid-cols-2
                  gap-4
                  "
                >

                  <div
                    className="
                    bg-gray-100
                    rounded-3xl
                    p-5
                    "
                  >

                    <p
                      className="
                      text-xs
                      text-gray-400
                      font-black
                      uppercase
                      tracking-[4px]
                      "
                    >
                      Brand
                    </p>

                    <h3
                      className="
                      font-black
                      mt-3
                      text-xl
                      "
                    >
                      {product.brand}
                    </h3>

                  </div>

                  <div
                    className="
                    bg-gray-100
                    rounded-3xl
                    p-5
                    "
                  >

                    <p
                      className="
                      text-xs
                      text-gray-400
                      font-black
                      uppercase
                      tracking-[4px]
                      "
                    >
                      Category
                    </p>

                    <h3
                      className="
                      font-black
                      mt-3
                      text-xl
                      "
                    >
                      Sneakers
                    </h3>

                  </div>

                </div>

              </div>

            </div>

          ))}

        </div>

        {/* FEATURES */}

        <div
          className="
          mt-14
          bg-black
          text-white
          rounded-[40px]
          p-10
          shadow-2xl
          "
        >

          <h2
            className="
            text-4xl
            font-black
            "
          >
            ERP Barcode Features 🚀
          </h2>

          <div
            className="
            grid
            grid-cols-1
            md:grid-cols-2
            xl:grid-cols-4
            gap-6
            mt-10
            "
          >

            <div
              className="
              bg-white/10
              rounded-3xl
              p-7
              backdrop-blur-lg
              "
            >

              <h3
                className="
                font-black
                text-2xl
                "
              >
                Barcode Scanner
              </h3>

              <p className="text-gray-300 mt-4">
                USB & camera scanner support.
              </p>

            </div>

            <div
              className="
              bg-white/10
              rounded-3xl
              p-7
              backdrop-blur-lg
              "
            >

              <h3
                className="
                font-black
                text-2xl
                "
              >
                Print Labels
              </h3>

              <p className="text-gray-300 mt-4">
                Thermal printer ready labels.
              </p>

            </div>

            <div
              className="
              bg-white/10
              rounded-3xl
              p-7
              backdrop-blur-lg
              "
            >

              <h3
                className="
                font-black
                text-2xl
                "
              >
                Smart SKU
              </h3>

              <p className="text-gray-300 mt-4">
                Auto generated enterprise SKUs.
              </p>

            </div>

            <div
              className="
              bg-white/10
              rounded-3xl
              p-7
              backdrop-blur-lg
              "
            >

              <h3
                className="
                font-black
                text-2xl
                "
              >
                QR + Barcode
              </h3>

              <p className="text-gray-300 mt-4">
                Brand level product tracking.
              </p>

            </div>

          </div>

        </div>

      </div>

    </div>

  );
}