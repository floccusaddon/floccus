export async function registerNodeSuite() {
  await import('./account.test.js')
  await import('./crypto.test.js')
  await import('./native_storage.test.js')
  await import('./caching_tree_wrapper.test.js')
  await import('./sync_basic.test.js')
  await import('./sync_basic_slave.test.js')
  await import('./sync_basic_overwrite.test.js')
  await import('./sync_advanced.test.js')
  await import('./sync_tags.test.js')

  if (process.env.FLOCCUS_NODE_INCLUDE_BENCHMARK === 'true') {
    await import('./benchmark.test.js')
  }
}
