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
    const {
      nome,
      telefone,
      cpf,
      servico,
      data,
      hora,
      valor
    } = req.body || {};

    if (!nome || !telefone || !cpf || !servico || !data || !hora || !valor) {
      return res.status(400).json({
        erro: "Todos os campos são obrigatórios"
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

    if (!pixResponse.ok) {
      return res.status(400).json({
        erro: "Erro ao buscar QR Code PIX",
        detalhes: pixData
      });
    }

    await db.collection("pix_pendentes").doc(pagamentoData.id).set({
      nome,
      telefone: telefoneLimpo,
      cpf: cpfLimpo,
      servico,
      valor: Number(valor),
      data,
      hora,
      status: "aguardando_pagamento",
      pagamento: "Pix",
      paymentId: pagamentoData.id,
      customerId: clienteData.id,
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({
      customerId: clienteData.id,
      paymentId: pagamentoData.id,
      copiaECola: pixData.payload || null,
      qrCode: pixData.encodedImage || null
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
    console.log("WEBHOOK RECEBIDO:", JSON.stringify(req.body, null, 2));

    const payment = req.body.payment;

    if (!payment || !payment.id) {
      return res.status(200).json({ ok: true });
    }

    if (
      payment.status === "RECEIVED" ||
      payment.status === "CONFIRMED"
    ) {
      const pendenteRef = db
        .collection("pix_pendentes")
        .doc(payment.id);

      const pendenteDoc = await pendenteRef.get();

      if (!pendenteDoc.exists) {
        console.log("PIX pendente não encontrado:", payment.id);
        return res.status(200).json({ ok: true });
      }

      const dados = pendenteDoc.data();

      await db.collection("agendamentos").add({
        nome: dados.nome,
        telefone: dados.telefone,
        cpf: dados.cpf,
        servico: dados.servico,
        valor: dados.valor,
        data: dados.data,
        hora: dados.hora,
        status: "confirmado",
        pagamento: "Pago",
        paymentId: payment.id,
        customerId: dados.customerId || "",
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        confirmadoEm: admin.firestore.FieldValue.serverTimestamp()
      });

      await pendenteRef.update({
        status: "pago",
        confirmadoEm: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log("AGENDAMENTO CRIADO APÓS PAGAMENTO:", payment.id);
    }

    return res.status(200).json({ ok: true });

  } catch (erro) {
    console.log("ERRO WEBHOOK:", erro);

    return res.status(500).json({
      erro: erro.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
