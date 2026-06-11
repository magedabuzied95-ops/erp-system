import { lazy, Suspense } from "react";
import {

  CalendarDays,

  CreditCard,

  User,

  ReceiptText,

  Phone,

  MapPin

} from "lucide-react";

const QRCode = lazy(() => import("react-qr-code"));

function ThermalInvoice({

  cart,

  total,

  customerName,

  paymentMethod,

  discount = 0,
  invoiceNumber = "",


}) {

  /* ======================================================
     INVOICE ID
  ====================================================== */

  const invoiceId =
    invoiceNumber || "INV-PENDING";

  /* ======================================================
     DATE
  ====================================================== */

  const currentDate =
    new Date()
    .toLocaleString();

  /* ======================================================
     SUBTOTAL
  ====================================================== */

  const subtotal =
    cart.reduce(

      (acc, item) =>

        acc +

        (
          item.price *
          item.quantity
        ),

      0
    );

  const discountAmount =
    subtotal *
    (discount / 100);

  const finalTotal =
    total || 0;
  const paymentMethodLabel =
    String(paymentMethod || "").toLowerCase() === "personal"
      ? "عملية شخصية"
      : String(paymentMethod || "").toLowerCase() === "credit_sale"
        ? "آجل"
      : paymentMethod;

  return (

    <div

      id="invoice"

      className="
      bg-white
      text-black
      w-[380px]
      mx-auto
      p-6
      font-sans
      "
    >

      {/* ======================================================
         HEADER
      ====================================================== */}

      <div className="text-center border-b-2 border-dashed border-black pb-6">

        {/* LOGO */}

        <div
          className="
          w-20
          h-20
          rounded-full
          bg-black
          text-white
          mx-auto
          flex
          items-center
          justify-center
          text-3xl
          font-black
          "
        >

          TS

        </div>

        {/* STORE */}

        <h1
          className="
          text-4xl
          font-black
          mt-5
          tracking-wide
          "
        >

          TIGER STORE

        </h1>

        <p className="mt-2 text-sm">

          Premium Sneakers & Fashion

        </p>

        {/* CONTACT */}

        <div className="mt-5 text-xs space-y-2">

          <div className="flex items-center justify-center gap-2">

            <Phone size={14} />

            <span>
              +20 100 000 0000
            </span>

          </div>

          <div className="flex items-center justify-center gap-2">

            <MapPin size={14} />

            <span>
              Damietta, Egypt
            </span>

          </div>

        </div>

      </div>

      {/* ======================================================
         INFO
      ====================================================== */}

      <div className="py-6 border-b-2 border-dashed border-black text-sm space-y-4">

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-2 font-bold">

            <ReceiptText size={16} />

            Invoice

          </div>

          <span>

            #{invoiceId}

          </span>

        </div>

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-2 font-bold">

            <CalendarDays size={16} />

            Date

          </div>

          <span>

            {currentDate}

          </span>

        </div>

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-2 font-bold">

            <User size={16} />

            Customer

          </div>

          <span>

            {

              customerName ||

              "Walk-in Customer"
            }

          </span>

        </div>

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-2 font-bold">

            <CreditCard size={16} />

            Payment

          </div>

          <span>

            {paymentMethodLabel}

          </span>

        </div>

      </div>

      {/* ======================================================
         ITEMS
      ====================================================== */}

      <div className="py-6">

        <div className="space-y-5">

          {
            cart.map((item) => (

              <div

                key={item.variant_id}

                className="
                border-b
                border-dashed
                border-gray-400
                pb-4
                "
              >

                <div className="flex justify-between">

                  <div>

                    <h3 className="font-black text-lg">

                      {item.name}

                    </h3>

                    <p className="text-sm text-gray-600 mt-1">

                      {item.color}
                      {" / "}
                      {item.size}

                    </p>

                    <p className="text-xs text-gray-500 mt-1">

                      SKU:
                      {" "}
                      {item.sku}
                    </p>

                  </div>

                  <div className="text-right">

                    <p className="font-bold">

                      x{item.quantity}

                    </p>

                    <p className="text-lg font-black mt-2">

                      $

                      {

                        (
                          item.price *
                          item.quantity
                        ).toFixed(2)
                      }

                    </p>

                  </div>

                </div>

              </div>
            ))
          }

        </div>

      </div>

      {/* ======================================================
         TOTALS
      ====================================================== */}

      <div className="border-t-2 border-dashed border-black pt-6 space-y-3 text-sm">

        <div className="flex justify-between">

          <span>
            Subtotal
          </span>

          <span>

            $
            {subtotal.toFixed(2)}

          </span>

        </div>

        <div className="flex justify-between">

          <span>
            Discount
          </span>

          <span>

            -
            $
            {discountAmount.toFixed(2)}

          </span>

        </div>

        <div
          className="
          flex
          justify-between
          text-3xl
          font-black
          border-t
          border-dashed
          border-black
          pt-4
          mt-4
          "
        >

          <span>
            TOTAL
          </span>

          <span>

            $
            {finalTotal.toFixed(2)}

          </span>

        </div>

      </div>

      {/* ======================================================
         QR CODE
      ====================================================== */}

      <div className="flex justify-center mt-10">

        <div className="text-center">

          <Suspense fallback={null}>
          <QRCode

            value={

              JSON.stringify({

                invoice:
                  invoiceId,

                total:
                  finalTotal,

                customer:
                  customerName ||

                  "Walk In"
              })
            }

            size={130}

          />
          </Suspense>

          <p className="text-xs mt-3 text-gray-500">

            Scan Invoice

          </p>

        </div>

      </div>

      {/* ======================================================
         FOOTER
      ====================================================== */}

      <div className="text-center mt-10 border-t-2 border-dashed border-black pt-6">

        <h3 className="font-black text-lg">

          THANK YOU ❤️

        </h3>

        <p className="text-sm text-gray-600 mt-2">

          Visit Again

        </p>

        <p className="text-xs text-gray-500 mt-4">

          ERP PRO POS SYSTEM

        </p>

      </div>

    </div>
  );
}

export default ThermalInvoice;
