import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * BlockNote's Next.js guide suggests putting its packages in
   * serverExternalPackages. That is for @blocknote/server-util in Route
   * Handlers, which we do not use — and listing @blocknote/core there breaks the
   * build, because its CSS import ("@blocknote/core/fonts/inter.css") is then
   * handed to Node, which only understands .js/.mjs/.cjs/.json/.node.
   *
   * The editor is a client component, so nothing needs externalising.
   */
};

export default nextConfig;
