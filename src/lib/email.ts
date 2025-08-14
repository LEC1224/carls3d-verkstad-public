import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendOrderEmail(to: string, subject: string, text: string, attachments?: any[]) {
  await transporter.sendMail({
    from: `"3D-Print Service" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    attachments,
  });
}
