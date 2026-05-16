import {
  useState
} from "react";

import { api }
from "../shared/api/api";

function UploadTest() {

  /* =========================
     STATES
  ========================= */

  const [image, setImage] =
    useState(null);

  const [preview, setPreview] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  /* =========================
     SELECT IMAGE
  ========================= */

  const handleImage =
    (e) => {

      const file =
        e.target.files[0];

      if (!file) return;

      setImage(file);

      setPreview(
        URL.createObjectURL(file)
      );
    };

  /* =========================
     UPLOAD
  ========================= */

  const uploadImage =
    async () => {

      if (!image) {

        return alert(
          "Select Image First"
        );
      }

      try {

        setLoading(true);

        const formData =
          new FormData();

        formData.append(
          "image",
          image
        );

        const res =
          await api.post(
            "/upload",
            formData
          );

        console.log(res);

        alert(
          "Image Uploaded Successfully ✅"
        );

      } catch (err) {

        console.log(err);

        alert(
          "Upload Failed ❌"
        );

      } finally {

        setLoading(false);
      }
    };

  return (

    <div
      className="
      min-h-screen
      bg-gray-100
      dark:bg-gray-900
      p-8
      "
    >

      {/* HEADER */}

      <div
        className="
        flex
        items-center
        justify-between
        flex-wrap
        gap-5
        mb-8
        "
      >

        <div>

          <h1
            className="
            text-5xl
            font-black
            text-gray-800
            dark:text-white
            "
          >
            Upload Center 🚀
          </h1>

          <p
            className="
            text-gray-500
            mt-3
            text-lg
            "
          >
            Enterprise image upload system
          </p>

        </div>

        <div
          className="
          bg-gradient-to-r
          from-green-500
          to-emerald-600
          text-white
          px-8
          py-5
          rounded-3xl
          shadow-2xl
          font-black
          "
        >
          Smart Upload
        </div>

      </div>

      {/* CARD */}

      <div
        className="
        max-w-3xl
        mx-auto
        bg-white
        dark:bg-gray-800
        rounded-[35px]
        shadow-2xl
        p-10
        "
      >

        {/* DROP AREA */}

        <label
          className="
          border-2
          border-dashed
          border-gray-300
          dark:border-gray-600
          rounded-3xl
          h-[350px]
          flex
          flex-col
          items-center
          justify-center
          cursor-pointer
          hover:border-green-500
          transition-all
          overflow-hidden
          "
        >

          {
            preview

            ? (

              <img
                src={preview}

                alt="preview"

                className="
                w-full
                h-full
                object-cover
                "
              />

            ) : (

              <div className="text-center">

                <div
                  className="
                  text-7xl
                  mb-5
                  "
                >
                  📸
                </div>

                <h2
                  className="
                  text-3xl
                  font-black
                  dark:text-white
                  "
                >
                  Upload Product Image
                </h2>

                <p
                  className="
                  text-gray-500
                  mt-4
                  "
                >
                  Drag & Drop or Click Here
                </p>

              </div>

            )
          }

          <input
            type="file"

            hidden

            onChange={handleImage}
          />

        </label>

        {/* FILE INFO */}

        {
          image && (

            <div
              className="
              mt-6
              bg-gray-100
              dark:bg-gray-700
              p-5
              rounded-2xl
              flex
              items-center
              justify-between
              "
            >

              <div>

                <h3
                  className="
                  font-black
                  dark:text-white
                  "
                >
                  {image.name}
                </h3>

                <p
                  className="
                  text-gray-500
                  text-sm
                  mt-1
                  "
                >

                  {(
                    image.size / 1024
                  ).toFixed(2)}
                  {" "}
                  KB

                </p>

              </div>

              <div
                className="
                bg-green-100
                text-green-600
                px-5
                py-3
                rounded-2xl
                font-black
                "
              >
                Ready
              </div>

            </div>
          )
        }

        {/* BUTTON */}

        <button
          onClick={uploadImage}

          disabled={loading}

          className="
          mt-8
          w-full
          bg-gradient-to-r
          from-green-500
          to-emerald-600
          hover:from-green-600
          hover:to-emerald-700
          text-white
          py-5
          rounded-3xl
          font-black
          text-xl
          shadow-2xl
          transition-all
          duration-300
          disabled:opacity-70
          "
        >

          {
            loading

            ? "Uploading..."

            : "Upload Image 🚀"
          }

        </button>

      </div>

    </div>
  );
}

export default UploadTest;
