/*
 * #%L
 * metasfresh-e2e
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

import { appendHumanReadableNow, getLanguageSpecific } from '../../support/utils/utils';
import { Inventory, InventoryLine } from '../../support/utils/inventory';
import { Builder } from '../../support/utils/builder';
import { DiscountSchema } from '../../support/utils/discountschema';
import { ProductCategory } from '../../support/utils/product';
import { BPartner } from '../../support/utils/bpartner';
import { SalesOrder, SalesOrderLine } from '../../support/utils/sales_order';
import { salesOrders } from '../../page_objects/sales_orders';

// Price
let priceSystemName;
let priceListName;
let priceListVersionName;
let discountSchemaName;

// Packing
let productForPackingMaterial;
let packingInstructionsName;

// Products
let productCategoryName;
let productName;
let productType;

// BPartner
let bPartnerName;

// SO/HU
let productQty;
let soProductQuantity;
let expectedProductQtyAfterPicking;
let locatorId;

// test columns
// todo @kuba: these should be somehow made translation independent!
//   eg. add the columnId as a data object in the table header (data object instead of class coz it's free form text so it may contains spaces and periods);
//      ref: https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements
//   or something else?
const pickingOrderColumn = 'Order';
const huCodeColumn = 'Code';
const qtyCUColumn = 'Qty CU';
const productPartnerColumn = 'Product / Partner';

// test
let soDocNumber;
let soRecordId;
let huValue;

describe('Create test data', function() {
  it('Read fixture and prepare the names', function() {
    cy.fixture('picking/pick_in_a_new_HU.json').then(f => {
      priceSystemName = appendHumanReadableNow(f['priceSystemName']);
      priceListName = appendHumanReadableNow(f['priceListName']);
      priceListVersionName = appendHumanReadableNow(f['priceListVersionName']);
      discountSchemaName = appendHumanReadableNow(f['discountSchemaName']);

      productForPackingMaterial = appendHumanReadableNow(f['productForPackingMaterial']);
      packingInstructionsName = appendHumanReadableNow(f['packingInstructionsName']);

      productCategoryName = appendHumanReadableNow(f['productCategoryName']);
      productName = appendHumanReadableNow(f['productName']);
      productType = f['productType'];

      bPartnerName = appendHumanReadableNow(f['bPartnerName']);

      productQty = f['productQty'];
      soProductQuantity = f['soProductQuantity'];
      expectedProductQtyAfterPicking = f['expectedProductQtyAfterPicking'];
      locatorId = f['locatorId'];
    });
  });

  it('Create price entities', function() {
    Builder.createBasicPriceEntities(priceSystemName, priceListVersionName, priceListName, true);
    cy.fixture('discount/discountschema.json').then(discountSchemaJson => {
      Object.assign(new DiscountSchema(), discountSchemaJson)
        .setName(discountSchemaName)
        .apply();
    });
  });

  it('Create category', function() {
    cy.fixture('product/simple_productCategory.json').then(productCategoryJson => {
      Object.assign(new ProductCategory(), productCategoryJson)
        .setName(productCategoryName)
        .apply();
    });
  });

  it('Create packing related entities', function() {
    // eslint-disable-next-line
    Builder.createProductWithPriceUsingExistingCategory(priceListName, productForPackingMaterial, productForPackingMaterial, productType, "24_Gebinde");
    Builder.createPackingMaterial(productForPackingMaterial, packingInstructionsName);
  });

  it('Create product', function() {
    Builder.createProductWithPriceAndCUTUAllocationUsingExistingCategory(
      productCategoryName,
      productCategoryName,
      priceListName,
      productName,
      productName,
      productType,
      packingInstructionsName
    );
  });

  it('Create bPartner', function() {
    cy.fixture('sales/simple_customer.json').then(customerJson => {
      new BPartner({ ...customerJson, name: bPartnerName }).setCustomerDiscountSchema(discountSchemaName).apply();
    });

    cy.readAllNotifications();
  });

  it('Create  single-HU inventory doc', function() {
    let uomName;
    cy.fixture('product/simple_product.json').then(productJson => {
      uomName = getLanguageSpecific(productJson, 'c_uom');
    });

    cy.fixture('inventory/inventory.json').then(inventoryJson => {
      const docTypeName = getLanguageSpecific(inventoryJson, 'singleHUInventoryDocTypeName');

      const inventoryLine = new InventoryLine()
        .setProductName(productName)
        .setQuantity(productQty)
        .setC_UOM_ID(uomName)
        .setM_Locator_ID(locatorId)
        .setIsCounted(true);

      new Inventory()
        .setWarehouse(inventoryJson.warehouseName)
        .setDocType(docTypeName)
        .addInventoryLine(inventoryLine)
        .apply();
    });
  });

  it('Save HU Value', function() {
    cy.selectTab('M_InventoryLine');
    cy.selectNthRow(0);
    cy.openAdvancedEdit();
    cy.getStringFieldValue('M_HU_ID').then(val => {
      huValue = val.split('_')[0];
    });
    cy.pressDoneButton();
  });

  it('Create Sales Order', function() {
    new SalesOrder()
      .setBPartner(bPartnerName)
      .setPriceSystem(priceSystemName)
      .addLine(new SalesOrderLine().setProduct(productName).setQuantity(soProductQuantity))
      .apply();
    cy.completeDocument();

    cy.getCurrentWindowRecordId().then(id => (soRecordId = id));
    cy.getStringFieldValue('DocumentNo').then(docNO => (soDocNumber = docNO));
  });
});

describe('Pick the SO', function() {
  it('Visit "Picking Terminal (Prototype)"', function() {
    // unfortunately the picking assignment is not created instantly and there's no way to check when it is created except by refreshing the page,
    // so i have to wait for it to be created :(
    cy.waitUntilProcessIsFinished();
    cy.visitWindow('540345');
  });

  it('Select first row and run action Pick', function() {
    cy.selectRowByColumnAndValue(productPartnerColumn, productName);
    cy.executeQuickAction('WEBUI_Picking_Launcher');
  });

  it('Mark the HU as source', function() {
    cy.selectLeftTable().within(() => {
      cy.selectRowByColumnAndValue(pickingOrderColumn, soDocNumber, false, true);
    });
    cy.openPickingHUSelectionWindow();
    cy.selectRightTable().within(() => {
      cy.selectRowByColumnAndValue(huCodeColumn, huValue, false, true);
    });
    cy.executeQuickAction('WEBUI_Picking_HUEditor_Create_M_Source_HUs', true, false);
    cy.selectRightTable().within(() => {
      // expecting the HU to be here
      cy.selectRowByColumnAndValue(huCodeColumn, huValue, false, true);
    });
  });

  it('Run quick-action "Pick to new HU"', function() {
    cy.selectLeftTable().within(() => {
      cy.selectRowByColumnAndValue(pickingOrderColumn, soDocNumber, false, true);
    });
    cy.selectRightTable().within(() => {
      cy.selectNthRow(0, false, true);
    });
    cy.executeQuickAction('WEBUI_Picking_PickQtyToNewHU', false, true);

    cy.resetListValue('M_HU_PI_Item_Product_ID', true);
    cy.selectInListField('M_HU_PI_Item_Product_ID', packingInstructionsName, true);
    cy.getStringFieldValue('QtyCU').should('equals', soProductQuantity.toString(10));
    cy.pressStartButton();
  });

  it('Confirm Pick', function() {
    cy.selectLeftTable().within(() => {
      cy.selectRowByColumnAndValue(pickingOrderColumn, soDocNumber, false, true);
    });
    cy.selectRightTable().within(() => {
      cy.selectRowByColumnAndValue(qtyCUColumn, soProductQuantity, false, true);
    });
    cy.executeQuickAction('WEBUI_Picking_M_Picking_Candidate_Process', true, false);
    cy.waitForSaveIndicator();
    cy.pressDoneButton();
  });
});

describe('Checks after picking', function() {
  it('Open the Referenced Shipment Disposition', function() {
    salesOrders.visit(soRecordId);
    cy.openReferencedDocuments('M_ShipmentSchedule');

    cy.expectNumberOfRows(1);
    cy.selectNthRow(0).dblclick();
  });

  it('Shipment Disposition checks', function() {
    cy.expectCheckboxValue('IsToRecompute', false);
    cy.getStringFieldValue('C_BPartner_ID').should('contain', bPartnerName);
    cy.getStringFieldValue('M_Product_ID').should('contain', productName);
    cy.getStringFieldValue('C_Order_ID').should('equal', soDocNumber);
    cy.getStringFieldValue('QtyOrdered_Calculated').should('equal', soProductQuantity.toString(10));
    cy.getStringFieldValue('QtyToDeliver ').should('equal', '0');
    cy.getStringFieldValue('QtyPickList ').should('equal', soProductQuantity.toString(10));
  });

  // it('Visit HU Editor and expect the HU to have less quantity than initially', function() {
  //   // blocked by: https://github.com/metasfresh/metasfresh-e2e/issues/327

  //   cy.visitWindow(540189);
  //   toggleNotFrequentFilters();
  //   selectNotFrequentFilterWidget('default');
  //   cy.writeIntoStringField('Value', huValue, false, null, true);
  //
  //   applyFilters();
  //
  //   cy.expectNumberOfRows(1);
  //   cy.selectNthRow(0).dblclick();
  //   cy.selectTab('M_HU_Storage');
  //   cy.selectNthRow(0);
  //   cy.openAdvancedEdit();
  //   cy.getStringFieldValue('Qty').should('equals', expectedProductQtyAfterPicking.toString(10));
  //   cy.pressDoneButton();
  // });
});
