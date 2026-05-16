import BarcodeScanner
from "react-qr-barcode-scanner";

function Scanner({
  onScan
}) {

  return (

    <div
      className="
      rounded-3xl
      overflow-hidden
      shadow-2xl
      "
    >

      <BarcodeScanner

        width={500}

        height={500}

        onUpdate={(
          err,
          result
        ) => {

          if (result) {

            onScan(
              result.text
            );
          }
        }}

      />

    </div>
  );
}

export default Scanner;