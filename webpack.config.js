import path from "node:path";
import { fileURLToPath } from "node:url";
import CopyPlugin from "copy-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default (_env, argv) => ({
  mode: argv.mode ?? "production",
  devtool: argv.mode === "development" ? "inline-source-map" : false,
  entry: {
    background: "./src/background.js",
    ui: "./src/ui.js",
    "transcription-worker": "./src/transcription-worker.js"
  },
  resolve: {
    alias: {
      "@huggingface/transformers": path.resolve(
        __dirname,
        "node_modules/@huggingface/transformers"
      )
    }
  },
  output: {
    path: path.resolve(__dirname, "build"),
    filename: "[name].js",
    clean: true,
    chunkLoading: false
  },
  optimization: {
    splitChunks: false,
    runtimeChunk: false
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/ui.html",
      filename: "ui.html",
      chunks: ["ui"],
      inject: "body"
    }),
    new CopyPlugin({
      patterns: [
        { from: "public", to: "." },
        { from: "src/ui.css", to: "ui.css" },
        {
          from: "node_modules/onnxruntime-web/dist/*.wasm",
          to: "ort/[name][ext]"
        },
        {
          from: "node_modules/onnxruntime-web/dist/*.mjs",
          to: "ort/[name][ext]"
        }
      ]
    })
  ]
});
