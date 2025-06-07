import express from 'express';
import handler from './api/proxy.js';

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.all('/', (req, res) => {
  handler(req, res);
});

app.listen(port, () => {
  console.log(`Proxy running at http://localhost:${port}`);
});