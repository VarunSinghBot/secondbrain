(async () => {
  try {
    const res = await fetch('http://localhost:8090/ingest-async', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentId: 'c1', userId: 'u1', sourceType: 'article', text: 'hello world' }),
    })
    const text = await res.text()
    console.log('STATUS:', res.status)
    console.log(text)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
})()
