package de.metas.paypalplus.processor;

import java.net.URL;

import org.adempiere.exceptions.AdempiereException;
import org.adempiere.service.IClientDAO;
import org.springframework.stereotype.Component;

import com.google.common.annotations.VisibleForTesting;
import com.google.common.collect.ImmutableList;
import com.paypal.orders.AmountWithBreakdown;
import com.paypal.orders.ApplicationContext;
import com.paypal.orders.Order;
import com.paypal.orders.OrderRequest;
import com.paypal.orders.PurchaseUnitRequest;

import de.metas.email.EMail;
import de.metas.email.MailService;
import de.metas.email.mailboxes.ClientEMailConfig;
import de.metas.email.mailboxes.Mailbox;
import de.metas.email.templates.MailTemplateId;
import de.metas.email.templates.MailTextBuilder;
import de.metas.i18n.TranslatableStrings;
import de.metas.money.CurrencyRepository;
import de.metas.payment.PaymentRule;
import de.metas.payment.processor.PaymentProcessor;
import de.metas.payment.reservation.PaymentReservation;
import de.metas.payment.reservation.PaymentReservationStatus;
import de.metas.paypalplus.PayPalConfig;
import de.metas.paypalplus.orders.PayPalOrder;
import de.metas.paypalplus.orders.PayPalOrderId;
import de.metas.paypalplus.orders.PayPalOrderService;
import de.metas.util.Services;
import lombok.NonNull;

/*
 * #%L
 * de.metas.payment.paypalplus
 * %%
 * Copyright (C) 2019 metas GmbH
 * %%
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as
 * published by the Free Software Foundation, either version 2 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public
 * License along with this program. If not, see
 * <http://www.gnu.org/licenses/gpl-2.0.html>.
 * #L%
 */

@Component
public class PayPalPaymentProcessor implements PaymentProcessor
{
	private final IClientDAO clientsRepo = Services.get(IClientDAO.class);
	private final PayPalClient payPalClient;
	private final PayPalOrderService payPalOrdersService;
	private final CurrencyRepository currencyRepo;
	private final MailService mailService;

	@VisibleForTesting
	public static final String MAIL_VAR_ApproveURL = "ApproveURL";
	@VisibleForTesting
	public static final String MAIL_VAR_Amount = "Amount";

	public PayPalPaymentProcessor(
			@NonNull final PayPalClient payPalClient,
			@NonNull final PayPalOrderService payPalOrdersService,
			@NonNull final CurrencyRepository currencyRepo,
			@NonNull final MailService mailService)
	{
		this.payPalClient = payPalClient;
		this.payPalOrdersService = payPalOrdersService;
		this.currencyRepo = currencyRepo;
		this.mailService = mailService;
	}

	@Override
	public PaymentRule getPaymentRule()
	{
		return PaymentRule.PayPal;
	}

	@Override
	public boolean canReserveMoney()
	{
		return true;
	}

	public PayPalOrder updatePayPalOrderFromAPI(@NonNull final PayPalOrderId externalId)
	{
		final Order apiOrder = payPalClient.getAPIOrderById(externalId);
		return payPalOrdersService.save(externalId, apiOrder);
	}

	@Override
	public void processReservation(@NonNull final PaymentReservation reservation)
	{
		final PaymentReservationStatus status = reservation.getStatus();

		if (PaymentReservationStatus.WAITING_PAYER_APPROVAL.equals(status))
		{
			createPayPalOrderAndRequestPayerApproval(reservation);
		}
		else if (PaymentReservationStatus.APPROVED_BY_PAYER.equals(status))
		{
			authorizePayPalOrder(reservation);
		}
		else if (PaymentReservationStatus.COMPLETED.equals(status))
		{
			throw new AdempiereException("already completed: " + reservation);
		}
		else if (PaymentReservationStatus.VOIDED.equals(status))
		{
			throw new AdempiereException("Request for approval for a voided reservation makes no sense: " + reservation);
		}
		else
		{
			throw new AdempiereException("Unknown status: " + reservation);
		}
	}

	private void createPayPalOrderAndRequestPayerApproval(final PaymentReservation reservation)
	{
		final PayPalConfig config = payPalClient.getConfig();
		final OrderRequest apiRequest = toAPIOrderRequest(reservation, config);
		final Order apiOrder = payPalClient.createOrder(apiRequest, toPayPalClientExecutionContext(reservation));
		final PayPalOrder order = payPalOrdersService.save(reservation.getId(), apiOrder);

		final URL payerApproveUrl = order.getPayerApproveUrl();
		sendPayerApprovalRequestEmail(reservation, payerApproveUrl, config.getOrderApproveMailTemplateId());
	}

	private static PayPalClientExecutionContext toPayPalClientExecutionContext(final PaymentReservation reservation)
	{
		return PayPalClientExecutionContext.builder()
				.paymentReservationId(reservation.getId())
				.salesOrderId(reservation.getSalesOrderId())
				.build();
	}

	public void authorizePayPalOrder(final PaymentReservation reservation)
	{
		reservation.getStatus().assertApprovedByPayer();

		PayPalOrder paypalOrder = payPalOrdersService.getByReservationId(reservation.getId());
		final Order apiOrder = payPalClient.authorizeOrder(paypalOrder.getExternalId(), toPayPalClientExecutionContext(reservation));

		paypalOrder = payPalOrdersService.save(reservation.getId(), apiOrder);
		if (!paypalOrder.isAuthorized())
		{
			throw new AdempiereException("Not authorized: " + paypalOrder);
		}

		reservation.changeStatusTo(paypalOrder.getStatus().toPaymentReservationStatus());
	}

	private void sendPayerApprovalRequestEmail(
			@NonNull final PaymentReservation reservation,
			@NonNull final URL payerApproveUrl,
			@NonNull final MailTemplateId mailTemplateId)
	{
		final MailTextBuilder mailTextBuilder = mailService.newMailTextBuilder(mailTemplateId);
		mailTextBuilder.bpartnerContact(reservation.getPayerContactId());
		mailTextBuilder.customVariable(MAIL_VAR_ApproveURL, payerApproveUrl.toExternalForm());
		mailTextBuilder.customVariable(MAIL_VAR_Amount, TranslatableStrings.amount(reservation.getAmount().toAmount(currencyRepo::getCurrencyCodeById)));

		final Mailbox mailbox = findMailbox(reservation);
		final EMail email = mailService.createEMail(mailbox,
				reservation.getPayerEmail(),
				mailTextBuilder.getMailHeader(),
				mailTextBuilder.getFullMailText(),
				mailTextBuilder.isHtml());

		mailService.send(email);

	}

	private Mailbox findMailbox(@NonNull final PaymentReservation reservation)
	{
		final ClientEMailConfig tenantEmailConfig = clientsRepo.getEMailConfigById(reservation.getClientId());

		return mailService.findMailBox(tenantEmailConfig, reservation.getOrgId());
	}

	private OrderRequest toAPIOrderRequest(
			@NonNull final PaymentReservation reservation,
			@NonNull final PayPalConfig config)
	{
		return new OrderRequest()
				.intent("AUTHORIZE")
				.applicationContext(new ApplicationContext()
						.returnUrl(config.getOrderApproveCallbackUrl())
						.cancelUrl(config.getOrderApproveCallbackUrl()))
				.purchaseUnits(ImmutableList.of(
						new PurchaseUnitRequest()
								.amount(toAmountWithBreakdown(reservation.getAmount()))));
	}

	private AmountWithBreakdown toAmountWithBreakdown(final de.metas.money.Money amount)
	{
		return new AmountWithBreakdown()
				.value(amount.getAsBigDecimal().toString())
				.currencyCode(currencyRepo.getCurrencyCodeById(amount.getCurrencyId()).toThreeLetterCode());
	}

	@Override
	public void captureMoney()
	{
	}

}
