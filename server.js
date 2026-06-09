
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensagem: "Backend PIX Barbearia rodando"
  });
});

app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, telefone, valor } = req.body || {};

    if (!nome || !telefone || !valor) {
      return res.status(400).json({
        erro: "Nome, telefone e valor são obrigatórios"
      });
    }

    if (!process.env.ASAAS_TOKEN) {
      return res.status(500).json({
        erro: "ASAAS_TOKEN não configurado no Render"
      });
    }

    const clienteResponse = await fetch(
      "https://www.asaas.com/api/v3/customers",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "access_token": process.env.ASAAS_TOKEN
        },
        body: JSON.stringify({
          name: nome,
          mobilePhone: telefone
        })
      }
    );

    const clienteData = await clienteResponse.json();

    if (!clienteResponse.ok || !clienteData.id) {
      return res.status(400).json({
        erro: "Erro ao criar cliente no Asaas",
        detalhes: clienteData
      });
    }

    const pagamentoResponse = await fetch(
      "https://www.asaas.com/api/v3/payments",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "access_token": process.env.ASAAS_TOKEN
        },
body: JSON.stringify({
  billingType: "PIX",
  value: Number(valor),
  customer: clienteData.id,
  dueDate: new Date().toISOString().split("T")[0],
  description: `Agendamento Barbearia Prime - ${nome}`,
  externalReference: telefone
})
      }
    );

    const pagamentoData = await pagamentoResponse.json();

    if (!pagamentoResponse.ok || !pagamentoData.id) {
      return res.status(400).json({
        erro: "Erro ao criar cobrança PIX no Asaas",
        detalhes: pagamentoData
      });
    }

    return res.status(200).json({
      customerId: clienteData.id,
      paymentId: pagamentoData.id,
      copiaECola: pagamentoData.pixTransaction?.payload || null,
      qrCode: pagamentoData.pixTransaction?.qrCode || null
    });

  } catch (erro) {
    console.log("Erro criar PIX:", erro);

    return res.status(500).json({
      erro: erro.message
    });
  }
});

app.post("/webhook-asaas", async (req, res) => {
  try {
    const body = req.body;

    console.log("Webhook Asaas:", body);

    const payment = body.payment;

    if (payment && payment.status === "RECEIVED") {
      console.log("PIX CONFIRMADO:", payment.id);
    }

    return res.status(200).json({
      ok: true
    });

  } catch (erro) {
    return res.status(500).json({
      erro: erro.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
