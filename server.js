const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  })
});

const db = admin.firestore();

app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensagem: "Backend PIX Barbearia rodando"
  });
});

app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, telefone, cpf, valor } = req.body || {};

    if (!nome || !telefone || !cpf || !valor) {
      return res.status(400).json({
        erro: "Nome, telefone, CPF e valor são obrigatórios"
      });
    }

    const cpfLimpo = String(cpf).replace(/\D/g, "");
    const telefoneLimpo = String(telefone).replace(/\D/g, "");

    const clienteResponse = await fetch("https://www.asaas.com/api/v3/customers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "access_token": process.env.ASAAS_TOKEN
      },
      body: JSON.stringify({
        name: nome,
        mobilePhone: telefoneLimpo,
        cpfCnpj: cpfLimpo
      })
    });

    const clienteData = await clienteResponse.json();

    if (!clienteResponse.ok || !clienteData.id) {
      return res.status(400).json({
        erro: "Erro ao criar cliente no Asaas",
        detalhes: clienteData
      });
    }

    const pagamentoResponse = await fetch("https://www.asaas.com/api/v3/payments", {
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
        externalReference: telefoneLimpo
      })
    });

    const pagamentoData = await pagamentoResponse.json();

    if (!pagamentoResponse.ok || !pagamentoData.id) {
      return res.status(400).json({
        erro: "Erro ao criar cobrança PIX no Asaas",
        detalhes: pagamentoData
      });
    }

    const pixResponse = await fetch(
      `https://www.asaas.com/api/v3/payments/${pagamentoData.id}/pixQrCode`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "access_token": process.env.ASAAS_TOKEN
        }
      }
    );

    const pixData = await pixResponse.json();

    return res.status(200).json({
      customerId: clienteData.id,
      paymentId: pagamentoData.id,
      copiaECola: pixData.payload || null,
      qrCode: pixData.encodedImage || null
    });

  } catch (erro) {
    return res.status(500).json({
      erro: erro.message
    });
  }
});

app.post("/webhook-asaas", async (req, res) => {
  try {
    const payment = req.body.payment;

    if (!payment || !payment.id) {
      return res.status(200).json({ ok: true });
    }

    if (
      payment.status === "RECEIVED" ||
      payment.status === "CONFIRMED"
    ) {
      const snapshot = await db
        .collection("agendamentos")
        .where("paymentId", "==", payment.id)
        .get();

      if (!snapshot.empty) {
        const batch = db.batch();

        snapshot.forEach((doc) => {
          batch.update(doc.ref, {
            status: "confirmado",
            pagamento: "Pago",
            confirmadoEm: admin.firestore.FieldValue.serverTimestamp()
          });
        });

        await batch.commit();
      }
    }

    return res.status(200).json({ ok: true });

  } catch (erro) {
    console.log("Erro webhook:", erro);

    return res.status(500).json({
      erro: erro.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
