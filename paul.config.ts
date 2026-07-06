import { defineConfig } from "@alipay/paul";

export default defineConfig({
  buildType: ["cube1", "mini", "h5"],
  paulPlugins: ["@alipay/paul-plugin-shandie", "@alipay/paul-plugin-hitu"],
});
